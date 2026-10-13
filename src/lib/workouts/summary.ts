/**
 * Workout summary computation + display formatting. Pure — used by the
 * finish screen, workout cards, and the denormalized posts.stats_data chip.
 */

import type { EntryExercise, EntrySet, SetMedia } from './entries';

const KG_TO_LBS = 2.20462;

/** Max media items attachable to a shared workout post. */
export const MAX_POST_MEDIA = 10;

export interface WorkoutSummary {
  exerciseCount: number;
  /** Sets that carry any data (reps, weight, duration, or distance). */
  totalSets: number;
  /** Σ reps × weight across all sets, kg converted to lbs. */
  totalVolumeLbs: number;
  /** Headline set, e.g. "Bench Press 185 lbs × 5" — heaviest weighted set. */
  topLine: string | null;
  /** Keyed by exercise_key when present, else normalized name — free-text
   *  "Bench Press" and catalog bench_press must not fork one lift. */
  perExerciseBest: Record<string, { maxWeightLbs: number | null; maxReps: number | null }>;
  // ── Workout screen PR 5 (Oct 12 2026) — optional: callers before it built literals without them. ──
  /** Volume per exercise, in order (the exercises with any volume). */
  perExerciseVolume?: Array<{ clientId: string; name: string; volumeLbs: number }>;
  /** Σ of the sets' recorded rests (260 `restSeconds`) — derived, never stored on the session. */
  restSeconds?: number;
  /** How many rests were recorded. */
  restCount?: number;
  /** restSeconds / restCount, rounded; null when no rest was recorded. */
  avgRestS?: number | null;
  /** The supersets and circuits, in order, with the rounds every member completed. */
  groups?: Array<{ groupId: string; kind: 'superset' | 'circuit'; rounds: number; completed: number; names: string[] }>;
}

/** A set with something in it (reps, weight, a time or a distance above 0). Rest is never data. */
export function setHasData(s: EntryExercise['sets'][number]): boolean {
  return (
    (s.reps !== null && s.reps > 0) ||
    (s.weight !== null && s.weight > 0) ||
    (s.durationSeconds !== null && s.durationSeconds > 0) ||
    (s.distance !== null && s.distance > 0)
  );
}

/** Canonical weight conversion — the ONE source of truth (also used by
 *  pr-detection and the dashboard stats). */
export function toLbs(weight: number, unit: 'lbs' | 'kg' | null): number {
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
      const key = exercise.exerciseKey ?? exercise.name.trim().toLowerCase();
      const existing = perExerciseBest[key];
      perExerciseBest[key] = existing
        ? {
            maxWeightLbs:
              maxWeightLbs === null ? existing.maxWeightLbs
                : existing.maxWeightLbs === null ? maxWeightLbs
                  : Math.max(existing.maxWeightLbs, maxWeightLbs),
            maxReps:
              maxReps === null ? existing.maxReps
                : existing.maxReps === null ? maxReps
                  : Math.max(existing.maxReps, maxReps),
          }
        : { maxWeightLbs, maxReps };
    }
  }

  // PR 5: volume per exercise, the rests, the groups' rounds completed.
  const perExerciseVolume: NonNullable<WorkoutSummary['perExerciseVolume']> = [];
  let restSeconds = 0;
  let restCount = 0;
  for (const exercise of exercises) {
    let volume = 0;
    for (const set of exercise.sets) {
      if (set.weight !== null && set.weight > 0 && set.reps !== null && set.reps > 0) volume += set.reps * toLbs(set.weight, set.weightUnit);
      if (typeof set.restSeconds === 'number' && set.restSeconds > 0) {
        restSeconds += set.restSeconds;
        restCount += 1;
      }
    }
    if (volume > 0) perExerciseVolume.push({ clientId: exercise.clientId, name: exercise.name, volumeLbs: Math.round(volume) });
  }
  const groups: NonNullable<WorkoutSummary['groups']> = [];
  let i = 0;
  while (i < exercises.length) {
    const e = exercises[i];
    if (!e.groupId) { i += 1; continue; }
    let j = i;
    while (j < exercises.length && exercises[j].groupId === e.groupId) j += 1;
    if (j - i >= 2) {
      const members = exercises.slice(i, j);
      const rounds = e.groupRounds ?? Math.max(1, ...members.map(m => m.sets.length));
      let completed = 0;
      for (let k = 0; k < rounds; k++) if (members.every(m => m.sets[k] && setHasData(m.sets[k]))) completed += 1;
      groups.push({ groupId: e.groupId, kind: e.groupKind ?? 'circuit', rounds, completed, names: members.map(m => m.name) });
    }
    i = j;
  }

  return {
    exerciseCount: exercises.length,
    totalSets,
    totalVolumeLbs: Math.round(totalVolumeLbs),
    topLine,
    perExerciseBest,
    perExerciseVolume,
    restSeconds,
    restCount,
    avgRestS: restCount > 0 ? Math.round(restSeconds / restCount) : null,
    groups,
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

/** "5 reps × 185 lbs", "3:00", "3 mi × 24:00" — one set's data as a line. */
export function formatSetLine(set: EntrySet): string {
  const parts: string[] = [];
  if (set.reps !== null && set.reps > 0) parts.push(`${set.reps} reps`);
  if (set.weight !== null && set.weight > 0) parts.push(`${set.weight} ${set.weightUnit ?? 'lbs'}`);
  if (set.durationSeconds !== null && set.durationSeconds > 0) parts.push(formatElapsed(set.durationSeconds));
  if (set.distance !== null && set.distance > 0) parts.push(`${set.distance} ${set.distanceUnit ?? 'mi'}`);
  return parts.join(' × ') || '—';
}

export interface CollectedMedia extends SetMedia {
  exerciseName: string;
  setNumber: number;
  /** Where the clip lives (workout capture round PR 2, Oct 8 2026) — the
   *  share step edits and removes a clip IN its set by these. */
  exerciseIndex: number;
  setIndex: number;
  mediaIndex: number;
}

/** All set media across the workout, ordered by exercise then set number. */
export function collectWorkoutMedia(exercises: EntryExercise[]): CollectedMedia[] {
  const collected: CollectedMedia[] = [];
  exercises.forEach((exercise, exerciseIndex) => {
    exercise.sets.forEach((set, setIndex) => {
      (set.media ?? []).forEach((media, mediaIndex) => {
        collected.push({ ...media, exerciseName: exercise.name, setNumber: set.setNumber, exerciseIndex, setIndex, mediaIndex });
      });
    });
  });
  return collected;
}

/**
 * The denormalized `posts.stats_data` payload for a shared workout — the
 * shape WorkoutPostCard renders in the feed. Built here (not inline at the
 * share site) so the calendar's preview of an UNSHARED workout can render
 * the exact same card without the two ever drifting apart.
 */
export function buildWorkoutStatsData(input: {
  sessionId: string;
  title: string | null;
  /** NULL for an untimed workout (260): the key is OMITTED, never 0 ("1 min"). */
  durationSeconds: number | null;
  summary: WorkoutSummary;
  /** PRs the athlete confirmed at finish — display data only; the field is
   *  omitted entirely when empty so old posts' shape stays byte-identical. */
  prs?: Array<{ label: string; display: string }>;
}): Record<string, unknown> {
  return {
    type: 'workout_session',
    workout_session_id: input.sessionId,
    title: input.title?.trim() || 'Workout',
    ...(input.durationSeconds === null ? {} : { duration_seconds: input.durationSeconds }),
    exercise_count: input.summary.exerciseCount,
    total_sets: input.summary.totalSets,
    total_volume_lbs: input.summary.totalVolumeLbs,
    top_line: input.summary.topLine,
    ...(input.prs && input.prs.length > 0
      ? { prs: input.prs.map(pr => ({ label: pr.label, display: pr.display })) }
      : {}),
    // PR 5: the rests, the active time and the groups — ONLY when present, so
    // an older workout's post keeps its shape byte-identical.
    ...(input.summary.restSeconds && input.summary.restSeconds > 0
      ? {
          rest_seconds: input.summary.restSeconds,
          ...(input.summary.avgRestS ? { avg_rest_seconds: input.summary.avgRestS } : {}),
          ...(input.durationSeconds !== null && input.durationSeconds > input.summary.restSeconds ? { active_seconds: input.durationSeconds - input.summary.restSeconds } : {}),
        }
      : {}),
    ...(input.summary.groups && input.summary.groups.length > 0
      ? { groups: input.summary.groups.map(g => ({ kind: g.kind, rounds: g.rounds, completed: g.completed, names: g.names })) }
      : {}),
    ...(input.summary.perExerciseVolume && input.summary.perExerciseVolume.length > 1
      ? { per_exercise_volume_lbs: input.summary.perExerciseVolume.map(v => ({ name: v.name, volume_lbs: v.volumeLbs })) }
      : {}),
  };
}
