/**
 * Server row shapes → editor EntryExercise[] conversion.
 */

import { ensureClientIds, type EntryExercise, type EntrySet, type ExerciseGroupKind, type SetMedia } from './entries';

export interface ServerSetRow {
  set_number: number;
  reps: number | null;
  weight: number | null;
  weight_unit: 'lbs' | 'kg' | null;
  duration_seconds: number | null;
  distance: number | null;
  distance_unit: 'mi' | 'km' | 'm' | 'yd' | null;
  completed_at: string | null;
  media?: SetMedia[] | null;
  /** 260: the rest before the set. Absent on rows read before the column existed. */
  rest_seconds?: number | null;
}

export interface ServerExerciseRow {
  name: string;
  exercise_key: string | null;
  category: 'strength' | 'cardio' | 'mobility' | 'other';
  position: number;
  notes: string | null;
  sets?: ServerSetRow[];
  /** 260: the stable id (the column's default fills every row; optional here for pre-260 literals). */
  client_id?: string | null;
  group_id?: string | null;
  group_kind?: ExerciseGroupKind | null;
  group_rounds?: number | null;
}

export interface ServerWorkoutSession {
  id: string;
  profile_id: string;
  title: string | null;
  notes: string | null;
  status: 'active' | 'completed';
  source: 'live' | 'manual';
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  post_id: string | null;
  last_activity_at: string;
  updated_at: string;
  exercises?: ServerExerciseRow[];
  /** 265: how hard it felt (1–10). Optional: rows and literals from before the column. */
  effort?: number | null;
  /** 260: the clock's facts. Optional: rows and literals from before the columns. */
  timed?: boolean | null;
  paused_seconds?: number | null;
  paused_at?: string | null;
  /** 269: the owner hid it from their profile (visitors never receive a hidden session). */
  profile_hidden_at?: string | null;
  /** 253 / Training fixes PR 4 (Oct 21 2026): when the owner chose Post or Done. NULL on a completed session = unposted ("Finish posting"). */
  share_decided_at?: string | null;
}

export function serverToEntries(session: ServerWorkoutSession): EntryExercise[] {
  const exercises = [...(session.exercises ?? [])].sort((a, b) => a.position - b.position);
  // A row without client_id (a literal from before 260) is minted one here —
  // the column's default means a live row always has it.
  return ensureClientIds(exercises.map(exercise => ({
    clientId: exercise.client_id ?? undefined,
    name: exercise.name,
    exerciseKey: exercise.exercise_key,
    category: exercise.category,
    notes: exercise.notes,
    groupId: exercise.group_id ?? null,
    groupKind: exercise.group_kind ?? null,
    groupRounds: exercise.group_rounds ?? null,
    sets: [...(exercise.sets ?? [])]
      .sort((a, b) => a.set_number - b.set_number)
      .map(
        (set): EntrySet => ({
          setNumber: set.set_number,
          reps: set.reps,
          weight: set.weight,
          weightUnit: set.weight_unit,
          durationSeconds: set.duration_seconds,
          distance: set.distance,
          distanceUnit: set.distance_unit,
          completedAt: set.completed_at,
          media: Array.isArray(set.media) ? set.media : [],
          restSeconds: set.rest_seconds ?? null,
        })
      ),
  }))) as EntryExercise[];
}
