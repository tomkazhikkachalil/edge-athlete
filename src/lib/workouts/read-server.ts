// ── The readers of workout sessions (server) ────────────────────────────────
// Training redesign PR 4 (Nov 11 2026): what GET /api/workouts did inline —
// the nested select, the sort, the media proxy — lives here so the History
// route reads a workout exactly as that route does. Admin client; the ROUTE
// is the privacy boundary (who may read, and which rows).

import type { SupabaseClient } from '@supabase/supabase-js';
import { healStoredMediaUrl, toProxyUrl } from '@/lib/media/proxy-url';
import { workoutSessions } from './dashboard';
import type { ServerWorkoutSession } from './serialize';
import type { TrainingSession } from '@/lib/training/session-math';

export const WORKOUT_SESSION_SELECT = `
  *,
  exercises:workout_exercises (
    *,
    sets:workout_sets (*)
  )
`;

interface NestedRow {
  exercises?: Array<{ position: number; sets?: Array<{ set_number: number; media?: Array<{ url?: string; thumbnailUrl?: string }> }> }>;
}

/** Exercises by position, sets by number — PostgREST does not order an embed. */
export function sortNestedWorkouts(sessions: NestedRow[]): void {
  for (const session of sessions) {
    session.exercises?.sort((a, b) => a.position - b.position);
    for (const exercise of session.exercises ?? []) {
      exercise.sets?.sort((a, b) => a.set_number - b.set_number);
    }
  }
}

/**
 * Proxy workout-set media bytes (workout_sets.media JSONB: [{ url, ... }]),
 * governed by the owner profile's visibility + the training `workouts` aspect.
 * A row written before the Oct 4 heal may hold a proxied path: heal it on
 * read, so it renders and the next save stores it right. A clip's poster
 * (video posters PR 2b) rides the same proxy as the clip.
 */
export function proxyWorkoutMedia(sessions: NestedRow[], profileId: string): void {
  for (const session of sessions) {
    for (const exercise of session.exercises ?? []) {
      for (const set of exercise.sets ?? []) {
        if (!Array.isArray(set.media)) continue;
        set.media = set.media.map(m => {
          const stored = m?.url ? (healStoredMediaUrl(m.url) ?? m.url) : m?.url;
          const poster = m?.thumbnailUrl ? (healStoredMediaUrl(m.thumbnailUrl) ?? m.thumbnailUrl) : undefined;
          return {
            ...m,
            url: (stored ? toProxyUrl(stored, { type: 'workout', id: profileId }) : stored) ?? stored,
            ...(poster ? { thumbnailUrl: toProxyUrl(poster, { type: 'workout', id: profileId }) ?? poster } : {}),
          };
        });
      }
    }
  }
}

/** How far back Training's week maths reads (the activities' own window, read-server.ts SESSIONS_WEEKS). */
export const WORKOUT_SESSIONS_WEEKS = 52;
const WORKOUT_SESSIONS_MAX = 500;

// The week maths needs when, how long, and the sets' numbers — never a clip, a note or a rest.
const SESSIONS_SELECT =
  'id, title, status, started_at, ended_at, duration_seconds, timed, post_id, share_decided_at, effort, exercises:workout_exercises ( name, exercise_key, position, client_id, category, sets:workout_sets ( set_number, reps, weight, weight_unit, duration_seconds, distance, distance_unit ) )';

/**
 * The profile's completed workouts of the last year as TRAINING SESSIONS —
 * what the week, the streak and the load count. It replaces "the last 50
 * workouts" (the list route's cap), which an athlete who trains daily
 * outgrew in seven weeks.
 */
export async function listWorkoutSessions(
  admin: SupabaseClient,
  profileId: string,
  isOwner: boolean,
  now: number = Date.now()
): Promise<{ ok: true; sessions: TrainingSession[] } | { ok: false }> {
  const since = new Date(now - WORKOUT_SESSIONS_WEEKS * 7 * 86_400_000).toISOString();
  let q = admin.from('workout_sessions').select(SESSIONS_SELECT).eq('profile_id', profileId).eq('status', 'completed').gte('started_at', since).order('started_at', { ascending: false }).limit(WORKOUT_SESSIONS_MAX);
  if (!isOwner) q = q.is('profile_hidden_at', null).not('share_decided_at', 'is', null);
  const { data, error } = await q;
  if (error) {
    console.error('[workouts] sessions read failed:', error.message);
    return { ok: false };
  }
  return { ok: true, sessions: workoutSessions((data ?? []) as unknown as ServerWorkoutSession[]) };
}
