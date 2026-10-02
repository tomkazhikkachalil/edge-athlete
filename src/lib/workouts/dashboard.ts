/**
 * Derived stats for the Vitals dashboard — the numbers a professional
 * tracker leads with: this-week training load, streak, the latest personal
 * best, and per-exercise progression across sessions. Pure and node-tested;
 * everything computes client-side from the payloads the tab already fetches
 * (GET /api/vitals returns ALL entries, GET /api/workouts up to 50 sessions).
 */

import { EXERCISE_MAP } from '@/lib/workout-config';
import { VITAL_METRICS_MAP } from '@/lib/vitals-config';
import { serverToEntries, type ServerWorkoutSession } from './serialize';
import { toLbs } from './summary';
import {
  sessionsStreakWeeks,
  sessionsWeeklySummary,
  type VitalsSession,
  type WeeklySummary,
} from '@/lib/vitals/session-math';

// ── Weeks ────────────────────────────────────────────────────────────────────

// Training weeks start MONDAY 00:00 local — the rule lives in ./week.
export { startOfWeek } from './week';

/** Stored duration when present, else ended−started; 0 for open sessions. */
export function sessionSeconds(session: ServerWorkoutSession): number {
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

export type { WeekTotals, WeeklySummary } from '@/lib/vitals/session-math';

/** A COMPLETED workout as a Vitals session (the shape the week maths takes). */
export function workoutToSession(session: ServerWorkoutSession): VitalsSession {
  return {
    id: session.id,
    kind: 'workout',
    startedAt: session.started_at,
    seconds: sessionSeconds(session),
    volumeLbs: sessionVolumeLbs(session),
    title: session.title || 'Workout',
  };
}

/** The completed workouts of a list, as sessions. */
export function workoutSessions(sessions: readonly ServerWorkoutSession[]): VitalsSession[] {
  return sessions.filter(s => s.status === 'completed').map(workoutToSession);
}

/** This week vs last week — COMPLETED workouts only (the workout-only view;
 *  Vitals merges activities in first, see src/lib/vitals/sessions.ts). */
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

export interface VitalEntryLike {
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
export function latestPB(vitals: VitalEntryLike[]): LatestPB | null {
  const bestByMetric = new Map<string, number>();
  for (const entry of vitals) {
    if (entry.value === null) continue;
    const metric = VITAL_METRICS_MAP[entry.metric_key];
    if (!metric || metric.lower_is_better === null) continue;
    const current = bestByMetric.get(entry.metric_key);
    const better = metric.lower_is_better
      ? current === undefined || entry.value < current
      : current === undefined || entry.value > current;
    if (better) bestByMetric.set(entry.metric_key, entry.value);
  }

  let latest: LatestPB | null = null;
  let latestTime = -Infinity;
  for (const entry of vitals) {
    if (entry.value === null) continue;
    const best = bestByMetric.get(entry.metric_key);
    if (best === undefined || entry.value !== best) continue;
    const t = new Date(entry.recorded_at).getTime();
    if (t > latestTime) {
      latestTime = t;
      const metric = VITAL_METRICS_MAP[entry.metric_key];
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

// ── Exercise progression ─────────────────────────────────────────────────────

export interface ProgressionPoint {
  /** Session start date (ISO). */
  date: string;
  value: number;
  /** e.g. "185 lbs × 5" — the set behind the point. */
  meta: string;
}

export interface ExerciseProgression {
  key: string;
  /** Display name — catalog label when known, else the (first-seen) name. */
  label: string;
  /** What `value` measures. */
  unit: 'lbs' | 'reps' | 'sec';
  points: ProgressionPoint[];
}

/**
 * Identity for cross-session progress: the catalog key when present, else
 * the normalized free-text name — "Bench Press" (custom) and `bench_press`
 * (catalog) must not fork one lift's history.
 */
export function progressionKey(exerciseKey: string | null, name: string): string {
  return exerciseKey ?? name.trim().toLowerCase();
}

/**
 * Best set per session per exercise across all COMPLETED sessions, ascending
 * by date — the "am I getting stronger" series. The measured value follows
 * the exercise's inputMode: reps_weight → max weight (lbs); reps_only → max
 * reps; duration/distance_duration → max duration; unknown (custom) → weight
 * if any set has one, else reps.
 */
export function exerciseProgression(
  sessions: ServerWorkoutSession[]
): Map<string, ExerciseProgression> {
  const byKey = new Map<string, ExerciseProgression>();

  const ordered = [...sessions]
    .filter(s => s.status === 'completed')
    .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());

  for (const session of ordered) {
    // Best value per exercise key WITHIN this session
    const sessionBest = new Map<string, { value: number; meta: string; label: string; unit: ExerciseProgression['unit'] }>();

    for (const exercise of serverToEntries(session)) {
      const key = progressionKey(exercise.exerciseKey, exercise.name);
      const catalog = exercise.exerciseKey ? EXERCISE_MAP[exercise.exerciseKey] : undefined;
      const label = catalog?.label ?? exercise.name;

      for (const set of exercise.sets) {
        let value: number | null = null;
        let unit: ExerciseProgression['unit'] = 'lbs';
        let meta = '';

        const mode = catalog?.inputMode;
        const weightLbs =
          set.weight !== null && set.weight > 0 ? toLbs(set.weight, set.weightUnit) : null;

        if (mode === 'reps_only') {
          if (set.reps !== null && set.reps > 0) {
            value = set.reps; unit = 'reps'; meta = `${set.reps} reps`;
          }
        } else if (mode === 'duration' || mode === 'distance_duration') {
          if (set.durationSeconds !== null && set.durationSeconds > 0) {
            value = set.durationSeconds; unit = 'sec';
            meta = set.distance ? `${set.distance} ${set.distanceUnit ?? 'mi'}` : 'duration';
          }
        } else if (mode === 'reps_weight' || weightLbs !== null) {
          if (weightLbs !== null) {
            value = weightLbs; unit = 'lbs';
            meta = `${set.weight} ${set.weightUnit ?? 'lbs'}${set.reps ? ` × ${set.reps}` : ''}`;
          }
        } else if (set.reps !== null && set.reps > 0) {
          value = set.reps; unit = 'reps'; meta = `${set.reps} reps`;
        }

        if (value === null) continue;
        const existing = sessionBest.get(key);
        if (!existing || value > existing.value) {
          sessionBest.set(key, { value, meta, label, unit });
        }
      }
    }

    for (const [key, best] of sessionBest) {
      let progression = byKey.get(key);
      if (!progression) {
        progression = { key, label: best.label, unit: best.unit, points: [] };
        byKey.set(key, progression);
      }
      progression.points.push({
        date: session.started_at,
        value: Math.round(best.value * 10) / 10,
        meta: best.meta,
      });
    }
  }

  return byKey;
}

// ── Metric series ────────────────────────────────────────────────────────────

/** Ascending {date, value} series for one vitals metric — chart input. */
export function metricSeries(
  vitals: VitalEntryLike[],
  metricKey: string
): Array<{ date: string; value: number }> {
  return vitals
    .filter(v => v.metric_key === metricKey && v.value !== null)
    .map(v => ({ date: v.recorded_at, value: v.value as number }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}
