/**
 * Derived stats for the Training dashboard — the numbers a professional
 * tracker leads with: this-week training load, streak, the latest personal
 * best, and per-exercise progression across sessions. Pure and node-tested;
 * everything computes client-side from the payloads the tab already fetches
 * (GET /api/vitals returns ALL entries, GET /api/workouts up to 50 sessions).
 */

import { BODY_METRIC_MAP } from '@/lib/body-metrics-config';
import { serverToEntries, type ServerWorkoutSession } from './serialize';
import { toLbs } from './summary';
import {
  sessionsStreakWeeks,
  sessionsWeeklySummary,
  type TrainingSession,
  type WeeklySummary,
} from '@/lib/training/session-math';

// ── Weeks ────────────────────────────────────────────────────────────────────

// Training weeks start MONDAY 00:00 local — the rule lives in ./week.
export { startOfWeek } from './week';

/** Stored duration when present, else ended−started; 0 for open sessions —
 *  and 0 for an UNTIMED workout (260: `timed = false` saves no duration; the
 *  check comes first, or the NULL would fall back to wall-clock). */
export function sessionSeconds(session: ServerWorkoutSession): number {
  if (session.timed === false) return 0;
  if (session.duration_seconds !== null && session.duration_seconds > 0) {
    return session.duration_seconds;
  }
  if (session.ended_at) {
    const ms = new Date(session.ended_at).getTime() - new Date(session.started_at).getTime();
    return Math.max(0, Math.floor(ms / 1000));
  }
  return 0;
}

/** Total lifted volume (reps × weight, lbs) across every set of a session. */
export function sessionVolumeLbs(session: ServerWorkoutSession): number {
  let volume = 0;
  for (const exercise of serverToEntries(session)) {
    for (const set of exercise.sets) {
      if (set.reps !== null && set.reps > 0 && set.weight !== null && set.weight > 0) {
        volume += set.reps * toLbs(set.weight, set.weightUnit);
      }
    }
  }
  return volume;
}

export type { WeekTotals, WeeklySummary } from '@/lib/training/session-math';

const METRES_PER: Readonly<Record<'mi' | 'km' | 'm' | 'yd', number>> = { mi: 1609.344, km: 1000, m: 1, yd: 0.9144 };

/** A set's distance in metres (the unit the athlete typed), or 0. */
export function toMetres(distance: number | null, unit: 'mi' | 'km' | 'm' | 'yd' | null): number {
  if (distance === null || !(distance > 0)) return 0;
  return distance * METRES_PER[unit ?? 'mi'];
}

/** Distance covered across every cardio set of a session (metres), or null when none carries one. */
export function sessionDistanceM(session: ServerWorkoutSession): number | null {
  let total = 0;
  let any = false;
  for (const exercise of serverToEntries(session)) {
    for (const set of exercise.sets) {
      const m = toMetres(set.distance, set.distanceUnit);
      if (m > 0) {
        total += m;
        any = true;
      }
    }
  }
  return any ? Math.round(total) : null;
}

/** A COMPLETED workout as a Training session (the shape the week maths takes).
 *  Live Activities (Oct 4 2026): a cardio set's distance now travels with it. */
export function workoutToSession(session: ServerWorkoutSession): TrainingSession {
  const distanceM = sessionDistanceM(session);
  return {
    id: session.id,
    kind: 'workout',
    startedAt: session.started_at,
    seconds: sessionSeconds(session),
    volumeLbs: sessionVolumeLbs(session),
    title: session.title || 'Workout',
    ...(distanceM !== null ? { distanceM } : {}),
    ...(typeof session.effort === 'number' ? { effort: session.effort } : {}),
    // Unposted (Training fixes PR 4): the owner's Training says "Finish posting" on the row.
    ...(session.status === 'completed' && !session.post_id && !session.share_decided_at ? { unposted: true } : {}),
  };
}

/** The completed workouts of a list, as sessions. */
export function workoutSessions(sessions: readonly ServerWorkoutSession[]): TrainingSession[] {
  return sessions.filter(s => s.status === 'completed').map(workoutToSession);
}

/** This week vs last week — COMPLETED workouts only (the workout-only view;
 *  Training merges activities in first, see src/lib/training/sessions.ts). */
export function weeklySummary(
  sessions: ServerWorkoutSession[],
  now: Date = new Date()
): WeeklySummary {
  return sessionsWeeklySummary(workoutSessions(sessions), now);
}

/**
 * Consecutive weeks with at least one completed workout, counting back from
 * the current week (the rule is sessionsStreakWeeks').
 */
export function streakWeeks(
  sessions: ServerWorkoutSession[],
  now: Date = new Date()
): number {
  return sessionsStreakWeeks(workoutSessions(sessions), now);
}

// ── Personal bests ───────────────────────────────────────────────────────────

export interface BodyMetricEntryLike {
  metric_key: string;
  metric_label?: string | null;
  value: number | null;
  value_display?: string | null;
  recorded_at: string;
}

export interface LatestPB {
  metricKey: string;
  label: string;
  valueDisplay: string;
  recordedAt: string;
}

/**
 * The most recent entry that set (or tied) its metric's all-time best.
 * Direction comes from the catalog's `lower_is_better`; metrics where it is
 * null (the body category — height isn't a PR) are excluded.
 */
export function latestPB(bodyMetrics: BodyMetricEntryLike[]): LatestPB | null {
  const bestByMetric = new Map<string, number>();
  for (const entry of bodyMetrics) {
    if (entry.value === null) continue;
    const metric = BODY_METRIC_MAP[entry.metric_key];
    if (!metric || metric.lower_is_better === null) continue;
    const current = bestByMetric.get(entry.metric_key);
    const better = metric.lower_is_better
      ? current === undefined || entry.value < current
      : current === undefined || entry.value > current;
    if (better) bestByMetric.set(entry.metric_key, entry.value);
  }

  let latest: LatestPB | null = null;
  let latestTime = -Infinity;
  for (const entry of bodyMetrics) {
    if (entry.value === null) continue;
    const best = bestByMetric.get(entry.metric_key);
    if (best === undefined || entry.value !== best) continue;
    const t = new Date(entry.recorded_at).getTime();
    if (t > latestTime) {
      latestTime = t;
      const metric = BODY_METRIC_MAP[entry.metric_key];
      latest = {
        metricKey: entry.metric_key,
        label: entry.metric_label || metric?.label || entry.metric_key,
        valueDisplay:
          entry.value_display ||
          `${entry.value}${metric?.unit ? ` ${metric.unit}` : ''}`,
        recordedAt: entry.recorded_at,
      };
    }
  }
  return latest;
}

// ── Metric series ────────────────────────────────────────────────────────────

/** Ascending {date, value} series for one bodyMetrics metric — chart input. */
export function metricSeries(
  bodyMetrics: BodyMetricEntryLike[],
  metricKey: string
): Array<{ date: string; value: number }> {
  return bodyMetrics
    .filter(v => v.metric_key === metricKey && v.value !== null)
    .map(v => ({ date: v.recorded_at, value: v.value as number }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}
