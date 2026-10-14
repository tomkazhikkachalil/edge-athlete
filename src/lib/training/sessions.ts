// ── Training sessions: workouts and activities, one list (pure) ───────────────
// The merge Training renders from. A workout comes from GET /api/workouts, an
// activity from GET /api/profile/[id]/activities?sessions=1 (its own gate —
// "Only me" and the Training privacy aspect are applied there, never here).

import { workoutSessions } from '@/lib/workouts/dashboard';
import type { ServerWorkoutSession } from '@/lib/workouts/serialize';
import type { TrainingSession } from './session-math';

export type { TrainingSession } from './session-math';
export { sessionsActiveDays, sessionsStreakWeeks, sessionsWeeklyBars, sessionsWeeklySummary } from './session-math';

/** What the sessions read returns for one activity — the minimum Training needs. */
export interface ActivitySession {
  id: string;
  type: string;
  name: string;
  startedAt: string;
  elapsedS: number;
  movingS: number | null;
  distanceM: number | null;
  /** The provider's name when its terms ask for a credit ("Polar"). */
  sourceName?: string | null;
}

/** Moving time where the device recorded it, else elapsed (the Activities tab's rule). */
export function fromActivity(a: ActivitySession): TrainingSession {
  return {
    id: a.id,
    kind: 'activity',
    startedAt: a.startedAt,
    seconds: a.movingS ?? a.elapsedS,
    volumeLbs: 0,
    title: a.name,
    activityType: a.type,
    distanceM: a.distanceM,
    sourceName: a.sourceName ?? null,
  };
}

/** Completed workouts and activities together, newest first. */
export function mergeSessions(
  workouts: readonly ServerWorkoutSession[],
  activities: readonly ActivitySession[]
): TrainingSession[] {
  return [...workoutSessions(workouts), ...activities.map(fromActivity)].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
}
