/**
 * PR detection — compares a finished workout against the athlete's vitals
 * history for the mapped lifts (bench/squat/deadlift/OHP → max weight lbs;
 * pull-ups → max reps). Suggest-and-confirm: the finish screen offers the
 * candidates as checkboxes; nothing writes automatically.
 */

import { EXERCISE_MAP } from '@/lib/workout-config';
import { VITAL_METRICS_MAP } from '@/lib/vitals-config';
import { toLbs } from './summary';
import type { EntryExercise } from './entries';

export interface PRCandidate {
  metricKey: string;
  metricLabel: string;
  unit: string;
  /** lbs for the lifts, reps for pull-ups. */
  value: number;
  valueDisplay: string;
  /** null = first-ever entry for this metric. */
  previousBest: number | null;
}

export function detectPRs(
  exercises: EntryExercise[],
  vitals: Array<{ metric_key: string; value: number | null }>
): PRCandidate[] {
  // Best per metric from this workout
  const workoutBest = new Map<string, number>();
  for (const exercise of exercises) {
    if (!exercise.exerciseKey) continue;
    const catalog = EXERCISE_MAP[exercise.exerciseKey];
    const metricKey = catalog?.vitalMetricKey;
    if (!metricKey) continue;

    for (const set of exercise.sets) {
      let candidate: number | null = null;
      if (catalog.inputMode === 'reps_only') {
        if (set.reps !== null && set.reps > 0) candidate = set.reps;
      } else {
        if (set.weight !== null && set.weight > 0) {
          candidate = toLbs(set.weight, set.weightUnit);
        }
      }
      if (candidate !== null) {
        const prev = workoutBest.get(metricKey);
        if (prev === undefined || candidate > prev) workoutBest.set(metricKey, candidate);
      }
    }
  }

  // History best per metric
  const historyBest = new Map<string, number>();
  for (const v of vitals) {
    if (v.value === null || !workoutBest.has(v.metric_key)) continue;
    const prev = historyBest.get(v.metric_key);
    if (prev === undefined || v.value > prev) historyBest.set(v.metric_key, v.value);
  }

  const candidates: PRCandidate[] = [];
  for (const [metricKey, value] of workoutBest) {
    const metric = VITAL_METRICS_MAP[metricKey];
    if (!metric) continue;
    const previousBest = historyBest.get(metricKey) ?? null;
    if (previousBest !== null && value <= previousBest) continue;

    const rounded = Math.round(value * 10) / 10;
    candidates.push({
      metricKey,
      metricLabel: metric.label,
      unit: metric.unit,
      value: rounded,
      valueDisplay: `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} ${metric.unit}`,
      previousBest,
    });
  }

  return candidates.sort((a, b) => a.metricLabel.localeCompare(b.metricLabel));
}
