import type { SupabaseClient } from '@supabase/supabase-js';
import { dayKeyUTC, viewSalt, viewerMark, type ViewItem, type Viewer } from './hash';

// ── Impact, the server half (252) ─────────────────────────────────────────
// `recordPostViews` is the ONE writer of post_view_marks / views_count /
// plays_count: it keeps only the posts the viewer may see and did not write,
// marks each with the day's hash and asks `bump_post_views` once (raced
// against 1500 ms); a failure is logged once and swallowed — a beacon never
// fails a page. `runPostViewsPrune` is the daily cron's step (marks older
// than 2 days go; the counters keep the totals).

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the admin client is untyped here
type Admin = SupabaseClient<any, 'public', any>;
const TAG = '[post-views]';
let reported = false;

export const VIEW_MARK_RETENTION_DAYS = 2;

export function pruneCutoff(now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - VIEW_MARK_RETENTION_DAYS);
  return d.toISOString().slice(0, 10);
}

/** Which of `items` the viewer may count: published, visible to them, not their own. */
export async function visibleItems(admin: Admin, items: ViewItem[], viewerId: string | null): Promise<ViewItem[]> {
  const ids = Array.from(new Set(items.map(i => i.id)));
  if (ids.length === 0) return [];
  const { data: posts, error } = await admin
    .from('posts')
    .select('id, profile_id, visibility, status, profiles:profile_id (visibility)')
    .in('id', ids);
  if (error || !posts) return [];
  const byId = new Map<string, { profile_id: string; visibility: string; status: string; ownerPublic: boolean }>();
  for (const p of posts as { id: string; profile_id: string; visibility: string; status: string; profiles: { visibility?: string } | { visibility?: string }[] | null }[]) {
    const owner = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
    byId.set(p.id, { profile_id: p.profile_id, visibility: p.visibility, status: p.status, ownerPublic: owner?.visibility === 'public' });
  }
  // One follows read for every private author at once.
  const privateAuthors = Array.from(new Set(
    Array.from(byId.values()).filter(p => !(p.visibility === 'public' && p.ownerPublic)).map(p => p.profile_id)
  ));
  let followed = new Set<string>();
  if (viewerId && privateAuthors.length > 0) {
    const { data: follows } = await admin
      .from('follows')
      .select('following_id')
      .eq('follower_id', viewerId)
      .eq('status', 'accepted')
      .in('following_id', privateAuthors);
    followed = new Set((follows ?? []).map((f: { following_id: string }) => f.following_id));
  }
  return items.filter(i => {
    const p = byId.get(i.id);
    if (!p || p.status !== 'published') return false;
    if (viewerId && p.profile_id === viewerId) return false; // the owner's own views never count
    if (p.visibility === 'public' && p.ownerPublic) return true;
    return !!viewerId && followed.has(p.profile_id);
  });
}

export async function recordPostViews(admin: Admin, input: { items: ViewItem[]; viewer: Viewer; viewerId: string | null; now?: Date }): Promise<number> {
  const salt = viewSalt();
  if (!salt) return 0;
  const kept = await visibleItems(admin, input.items, input.viewerId);
  if (kept.length === 0) return 0;
  const day = dayKeyUTC(input.now ?? new Date());
  const hash = viewerMark(salt, day, input.viewer);
  const payload = kept.map(i => ({ id: i.id, kind: i.kind, hash }));
  const timeout = new Promise<{ data: null; error: { code?: string; message?: string } }>(resolve =>
    setTimeout(() => resolve({ data: null, error: { code: 'TIMEOUT', message: 'bump_post_views took too long' } }), 1500)
  );
  const result = await Promise.race([admin.rpc('bump_post_views', { p_day: day, p_items: payload }), timeout]);
  if (result.error) {
    if (!reported) {
      reported = true;
      console.error(`${TAG} views not recorded (once):`, result.error);
    }
    return 0;
  }
  return typeof result.data === 'number' ? result.data : 0;
}

export async function runPostViewsPrune(admin: Admin, now = new Date()): Promise<{ ok: boolean; marks: number }> {
  const marks = await admin.from('post_view_marks').delete().lt('day', pruneCutoff(now)).select('day');
  if (marks.error?.code === '42P01') return { ok: true, marks: 0 }; // pre-252
  if (marks.error) {
    console.error(`${TAG} prune error:`, marks.error);
    return { ok: false, marks: 0 };
  }
  return { ok: true, marks: marks.data?.length ?? 0 };
}
