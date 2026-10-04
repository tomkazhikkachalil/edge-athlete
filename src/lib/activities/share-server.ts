// ── "Share to feed": the post's payload and the link back (245) ────────────
// POST /api/posts calls these when a composer sends stats_data
// `{ type: 'activity', activity_id }`. The author must OWN the activity (the
// acting profile — a guardian posting for their athlete is resolved before
// this); "Only me" and an already-shared activity are refused by name; the
// payload is rebuilt from the row (post-card.ts), never taken from the client.

import { sourceCredit } from './connections';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isUuid } from '@/lib/uuid';
import { isActivityType } from './catalog';
import type { ActivityPostStats } from './post-card';
import { segmentsFromRow } from './segments';
import { segmentStats } from './stream';
import { readStream } from './read-server';

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
      .select('id, profile_id, activity_type, source, name, occurred_on, distance_m, moving_s, elapsed_s, elev_gain_m, avg_hr, route_preview, post_id, only_me, segments, steps, stream_path')
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
  // 251: the segments as the card shows them (measured from the stream, once,
  // here — the card is a denormalized snapshot by design) and the photo count.
  const segments = segmentsFromRow(a.segments);
  let segmentLines: NonNullable<ActivityPostStats['segments']> = [];
  if (segments.length > 0) {
    const stream = await readStream(admin, (a.stream_path as string | null) ?? null);
    if (stream) {
      segmentLines = segments
        .map(seg => {
          const stat = segmentStats(stream, seg);
          return stat ? { kind: seg.kind, label: seg.label ?? null, distance_m: stat.distanceM, seconds: stat.seconds } : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
    }
  }
  const { count: photoCount } = await admin.from('activity_media').select('id', { count: 'exact', head: true }).eq('activity_id', activityId);
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
      credit: sourceCredit(a.source as string),
      ...(segmentLines.length > 0 ? { segments: segmentLines } : {}),
      ...(typeof a.steps === 'number' ? { steps: a.steps } : {}),
      ...(photoCount ? { photo_count: photoCount } : {}),
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
