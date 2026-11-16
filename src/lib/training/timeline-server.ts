// ── The timeline's reader (server) ───────────────────────────────────────────
// "One wave", phase 2 (Nov 2026). Every session of the profile this audience
// may receive, as ONE narrow row each — when, how long, how far, how hard, its
// name. No sets, no clips, no route: the Year / Month / Week views count; a
// session's own page reads the rest. Admin client; the ROUTE decides who may
// read (resolveActivityAccess + the Training privacy aspect). The row rules
// are History's own (history-server.ts): a non-owner never receives a workout
// the owner hid or has not decided, nor an "Only me" activity.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isActivityType } from '@/lib/activities/catalog';
import type { ActivityAudience } from '@/lib/activities/visibility';
import type { TimelineSession } from './timeline';

/** PostgREST answers 1,000 rows a request; ten requests a table is twenty-seven years of a session a day. */
const PAGE = 1000;
export const TIMELINE_MAX = 10_000;

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

async function readAll(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>, what: string): Promise<Array<Record<string, unknown>> | null> {
  const rows: Array<Record<string, unknown>> = [];
  for (let from = 0; from < TIMELINE_MAX; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) {
      console.error(`[training/timeline] ${what} read failed:`, error.message);
      return null;
    }
    const got = (data ?? []) as Array<Record<string, unknown>>;
    rows.push(...got);
    if (got.length < PAGE) break;
  }
  return rows;
}

export async function readTrainingTimeline(
  admin: SupabaseClient,
  profileId: string,
  audience: ActivityAudience
): Promise<{ ok: true; sessions: TimelineSession[]; capped: boolean } | { ok: false }> {
  const isOwner = audience === 'owner';
  const [workouts, activities] = await Promise.all([
    readAll((from, to) => {
      let q = admin.from('workout_sessions').select('id, title, started_at, duration_seconds, effort').eq('profile_id', profileId).eq('status', 'completed');
      if (!isOwner) q = q.is('profile_hidden_at', null).not('share_decided_at', 'is', null);
      return q.order('started_at', { ascending: false }).order('id', { ascending: false }).range(from, to);
    }, 'workouts'),
    readAll((from, to) => {
      let q = admin.from('activities').select('id, name, activity_type, started_at, elapsed_s, moving_s, distance_m, effort').eq('profile_id', profileId);
      if (!isOwner) q = q.eq('only_me', false);
      return q.order('started_at', { ascending: false }).order('id', { ascending: false }).range(from, to);
    }, 'activities'),
  ]);
  if (!workouts || !activities) return { ok: false };
  const sessions: TimelineSession[] = [
    ...workouts.map(r => ({
      id: r.id as string,
      kind: 'workout' as const,
      startedAt: r.started_at as string,
      seconds: num(r.duration_seconds) ?? 0,
      distanceM: null,
      title: (r.title as string) || 'Workout',
      ...(typeof r.effort === 'number' ? { effort: r.effort } : {}),
    })),
    ...activities.map(r => ({
      id: r.id as string,
      kind: 'activity' as const,
      startedAt: r.started_at as string,
      seconds: num(r.moving_s) ?? num(r.elapsed_s) ?? 0,
      distanceM: num(r.distance_m),
      title: (r.name as string) ?? '',
      type: isActivityType(r.activity_type) ? r.activity_type : 'other',
      ...(typeof r.effort === 'number' ? { effort: r.effort } : {}),
    })),
  ].sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
  return { ok: true, sessions, capped: workouts.length >= TIMELINE_MAX || activities.length >= TIMELINE_MAX };
}
