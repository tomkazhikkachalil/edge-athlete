/**
 * Workout summary computation + display formatting. Pure — used by the
 * finish screen, workout cards, and the denormalized posts.stats_data chip.
 */

import type { EntryExercise } from './entries';

const KG_TO_LBS = 2.20462;

export interface WorkoutSummary {
  exerciseCount: number;
  /** Sets that carry any data (reps, weight, duration, or distance). */
  totalSets: number;
  /** Σ reps × weight across all sets, kg converted to lbs. */
  totalVolumeLbs: number;
  /** Headline set, e.g. "Bench Press 185 lbs × 5" — heaviest weighted set. */
  topLine: string | null;
  perExerciseBest: Record<string, { maxWeightLbs: number | null; maxReps: number | null }>;
}

function setHasData(s: EntryExercise['sets'][number]): boolean {
  return (
    (s.reps !== null && s.reps > 0) ||
    (s.weight !== null && s.weight > 0) ||
    (s.durationSeconds !== null && s.durationSeconds > 0) ||
    (s.distance !== null && s.distance > 0)
  );
}

function toLbs(weight: number, unit: 'lbs' | 'kg' | null): number {
  return unit === 'kg' ? weight * KG_TO_LBS : weight;
}

export function computeSummary(exercises: EntryExercise[]): WorkoutSummary {
  let totalSets = 0;
  let totalVolumeLbs = 0;
  let topLine: string | null = null;
  let topWeightLbs = 0;
  const perExerciseBest: WorkoutSummary['perExerciseBest'] = {};

  for (const exercise of exercises) {
    let maxWeightLbs: number | null = null;
    let maxReps: number | null = null;

    for (const set of exercise.sets) {
      if (!setHasData(set)) continue;
      totalSets++;

      if (set.reps !== null && set.reps > 0 && (maxReps === null || set.reps > maxReps)) {
        maxReps = set.reps;
      }
      if (set.weight !== null && set.weight > 0) {
        const lbs = toLbs(set.weight, set.weightUnit);
        if (maxWeightLbs === null || lbs > maxWeightLbs) maxWeightLbs = lbs;
        if (set.reps !== null && set.reps > 0) {
          totalVolumeLbs += set.reps * lbs;
        }
        if (lbs > topWeightLbs) {
          topWeightLbs = lbs;
          const unitLabel = set.weightUnit === 'kg' ? 'kg' : 'lbs';
          const repsPart = set.reps !== null && set.reps > 0 ? ` × ${set.reps}` : '';
          topLine = `${exercise.name} ${set.weight} ${unitLabel}${repsPart}`;
        }
      }
    }

    if (maxWeightLbs !== null || maxReps !== null) {
      perExerciseBest[exercise.name] = { maxWeightLbs, maxReps };
    }
  }

  return {
    exerciseCount: exercises.length,
    totalSets,
    totalVolumeLbs: Math.round(totalVolumeLbs),
    topLine,
    perExerciseBest,
  };
}

/** Stopwatch display: "47:12", "1:02:45". */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Human duration: "47 min", "1 h 2 min". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.round((s % 3600) / 60);
  if (hours === 0) return `${Math.max(1, minutes)} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

/** "12,450 lbs" */
export function formatVolume(lbs: number): string {
  return `${Math.round(lbs).toLocaleString('en-US')} lbs`;
}
