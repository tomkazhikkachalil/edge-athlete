/**
 * Workout session lifecycle — status derives from data, never from an
 * in-memory clock (golf round-status stance). Since the Drafts round (Oct
 * 2026) NOTHING finishes at read time: an abandoned live session stays
 * IN PROGRESS — in Drafts, behind the reopen prompt — until its owner
 * resumes, finishes or discards it, or the daily sweep's 7-day rule finishes
 * it as it stands (`runWorkoutSweep`). The 6 h lazy auto-end is gone: it put
 * a workout nobody finished on the profile.
 */

import { finishDuration } from './timing';

/** Untouched for this long → the sweep finishes it (Tom, Oct 6 2026). */
export const ABANDON_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export type WorkoutStatus = 'active' | 'completed';

/** The sweep's rule: an ACTIVE session whose last activity is older than ABANDON_AFTER_MS. Never a guess on a missing clock. */
export function isAbandonedSession(s: { status: WorkoutStatus | string; lastActivityAt: string | null; now?: number }): boolean {
  if (s.status !== 'active' || !s.lastActivityAt) return false;
  const t = Date.parse(s.lastActivityAt);
  if (Number.isNaN(t)) return false;
  return (s.now ?? Date.now()) - t > ABANDON_AFTER_MS;
}

/** Fields to persist when the sweep finishes an abandoned session: it ended
 *  at its last activity (never before an open pause — the clock stood there),
 *  with a truthful duration (pauses excluded; NULL when untimed — timing.ts
 *  finishDuration, the finish PATCH's rule). `share_decided_at` stays NULL —
 *  the owner never reached the share decision, so it is a DRAFT. */
export function abandonFinalizeFields(s: {
  startedAt: string;
  lastActivityAt: string;
  pausedSeconds?: number | null;
  pausedAt?: string | null;
  timed?: boolean | null;
}): { status: 'completed'; ended_at: string; duration_seconds: number | null; paused_at: null } {
  const plan = finishDuration(
    { started_at: s.startedAt, paused_seconds: s.pausedSeconds ?? 0, paused_at: s.pausedAt ?? null, timed: s.timed },
    Date.parse(s.lastActivityAt),
  );
  return {
    status: 'completed',
    ended_at: new Date(plan.endedMs).toISOString(),
    duration_seconds: plan.durationSeconds,
    paused_at: null,
  };
}
