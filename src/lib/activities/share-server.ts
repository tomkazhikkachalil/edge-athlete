// ── "Share to feed": the post's payload and the link back (245) ────────────
// POST /api/posts calls these when a composer sends stats_data
// `{ type: 'activity', activity_id }`. The author must OWN the activity (the
// acting profile — a guardian posting for their athlete is resolved before
// this); "Only me" and an already-shared activity are refused by name; the
// payload is rebuilt from the row (post-card.ts), never taken from the client.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isUuid } from '@/lib/uuid';
import { isActivityType } from './catalog';
import type { ActivityPostStats } from './post-card';

type Admin = SupabaseClient;

export async function buildActivityPostStats(
  admin: Admin,
  authorId: string,
  activityId: unknown
): Promise<{ ok: true; activityId: string; statsData: ActivityPostStats } | { ok: false; status: 400 | 404 | 409 | 500; error: string }> {
  if (typeof activityId !== 'string' || !isUuid(activityId)) return { ok: false, status: 400, error: 'Unknown activity' };
  const [actRes, profRes] = await Promise.all([
    admin
      .from('activities')
      .select('id, profile_id, activity_type, name, occurred_on, distance_m, moving_s, elapsed_s, elev_gain_m, avg_hr, route_preview, post_id, only_me')
      .eq('id', activityId)
      .maybeSingle(),
    admin.from('profiles').select('supervision_state').eq('id', authorId).maybeSingle(),
  ]);
  if (actRes.error || profRes.error) return { ok: false, status: 500, error: 'Could not read the activity.' };
  const a = actRes.data;
  if (!a || a.profile_id !== authorId) return { ok: false, status: 404, error: 'Unknown activity' };
  if (a.only_me) return { ok: false, status: 409, error: 'This activity is set to Only me. Change that first to share it.' };
  if (a.post_id) return { ok: false, status: 409, error: 'This activity is already on your feed.' };
  const supervised = profRes.data?.supervision_state === 'supervised';
  const num = (v: unknown) => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    ok: true,
    activityId,
    statsData: {
      type: 'activity',
      activity_id: activityId,
      activity_type: isActivityType(a.activity_type) ? a.activity_type : 'other',
      name: a.name as string,
      occurred_on: a.occurred_on as string,
      distance_m: num(a.distance_m),
      moving_s: a.moving_s as number | null,
      elapsed_s: a.elapsed_s as number,
      elev_gain_m: num(a.elev_gain_m),
      avg_hr: a.avg_hr as number | null,
      route_preview: supervised ? null : ((a.route_preview as string | null) ?? null),
    },
  };
}

/**
 * Point the activity at its new post. Returns false when another share won
 * the race (the activity already had a post) — the caller then removes the
 * post it just created, so one activity never has two cards.
 */
export async function linkActivityPost(admin: Admin, activityId: string, authorId: string, postId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('activities')
    .update({ post_id: postId })
    .eq('id', activityId)
    .eq('profile_id', authorId)
    .is('post_id', null)
    .select('id');
  if (error) {
    console.error('[activities] post link failed:', error.message);
    return false;
  }
  return (data ?? []).length === 1;
}
