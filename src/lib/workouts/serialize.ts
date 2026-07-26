/**
 * Server row shapes → editor EntryExercise[] conversion.
 */

import type { EntryExercise, EntrySet, SetMedia } from './entries';

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
}

export interface ServerExerciseRow {
  name: string;
  exercise_key: string | null;
  category: 'strength' | 'cardio' | 'mobility' | 'other';
  position: number;
  notes: string | null;
  sets?: ServerSetRow[];
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
}

export function serverToEntries(session: ServerWorkoutSession): EntryExercise[] {
  const exercises = [...(session.exercises ?? [])].sort((a, b) => a.position - b.position);
  return exercises.map(exercise => ({
    name: exercise.name,
    exerciseKey: exercise.exercise_key,
    category: exercise.category,
    notes: exercise.notes,
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
        })
      ),
  }));
}
