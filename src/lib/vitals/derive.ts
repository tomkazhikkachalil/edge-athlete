/**
 * Derivations for the bubble dashboard — the playful layer's numbers. Pure
 * and node-tested, computed client-side from the payloads the tab already
 * fetches; nothing here changes what is tracked or how PRs are detected
 * (that stays in workouts/dashboard.ts and workouts/pr-detection.ts).
 */

import { workoutSessions, type VitalEntryLike } from '@/lib/workouts/dashboard';
import { sessionsActiveDays, sessionsWeeklyBars, type WeekBar } from './session-math';
import { VITAL_METRICS_MAP, formatSecondsToDisplay } from '@/lib/vitals-config';
import type { ServerWorkoutSession } from '@/lib/workouts/serialize';

const DAY_MS = 24 * 3600 * 1000;

// ── Active days and weekly bars — the workout-only views ─────────────────────
// The rule itself is session-math.ts (it counts activities too once Vitals
// has merged them in); these keep the workout-only callers and their tests.

export type { WeekBar } from './session-math';

/**
 * Distinct local days with at least one COMPLETED workout in the current
 * Monday-anchored week — two sessions on one day count once.
 */
export function activeDaysThisWeek(
  sessions: ServerWorkoutSession[],
  now: Date = new Date()
): number {
  return sessionsActiveDays(workoutSessions(sessions), now);
}

/**
 * The last `weeks` Monday-anchored weeks (oldest first, current week last),
 * each with totals from COMPLETED sessions.
 */
export function weeklyBars(
  sessions: ServerWorkoutSession[],
  weeks: number,
  now: Date = new Date()
): WeekBar[] {
  return sessionsWeeklyBars(workoutSessions(sessions), weeks, now);
}

// ── Milestones ───────────────────────────────────────────────────────────────

export interface MetricMilestone {
  date: string;
  value: number;
  display: string;
}

function milestoneDisplay(entry: VitalEntryLike, metricKey: string): string {
  if (entry.value_display) return entry.value_display;
  const metric = VITAL_METRICS_MAP[metricKey];
  const value = entry.value as number;
  if (metric?.time_format === 'mm:ss') return formatSecondsToDisplay(value, 'mm:ss');
  if (metric?.time_format === 'decimal_seconds') return `${value} sec`;
  return `${value}${metric?.unit ? ` ${metric.unit}` : ''}`;
}

/**
 * Every entry that set (or tied) the metric's running best, in date order —
 * the "story so far" markers on a progression chart. Ties count, matching
 * latestPB. Body metrics (lower_is_better === null) have no milestones:
 * height isn't a PR.
 */
export function metricMilestones(
  vitals: VitalEntryLike[],
  metricKey: string
): MetricMilestone[] {
  const metric = VITAL_METRICS_MAP[metricKey];
  if (!metric || metric.lower_is_better === null) return [];

  const entries = vitals
    .filter(v => v.metric_key === metricKey && v.value !== null)
    .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());

  const milestones: MetricMilestone[] = [];
  let best: number | undefined;
  for (const entry of entries) {
    const value = entry.value as number;
    const beatsOrTies =
      best === undefined || (metric.lower_is_better ? value <= best : value >= best);
    if (!beatsOrTies) continue;
    best = value;
    milestones.push({
      date: entry.recorded_at,
      value,
      display: milestoneDisplay(entry, metricKey),
    });
  }
  return milestones;
}

// ── Recency ──────────────────────────────────────────────────────────────────

/**
 * True when a PB was recorded within the last `days` days — drives "New!"
 * chips. Tolerates up to a day of clock-forward skew: date-only timestamps
 * parse as UTC midnight, which can sit slightly ahead of local "now".
 */
export function isRecentPB(
  recordedAt: string,
  now: Date = new Date(),
  days = 7
): boolean {
  const age = now.getTime() - new Date(recordedAt).getTime();
  return age >= -DAY_MS && age < days * DAY_MS;
}
