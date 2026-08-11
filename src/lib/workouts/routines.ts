/**
 * Saved workout routines (presets) — a named, ordered exercise list with a
 * planned set count per exercise, no set values. Starting a session from a
 * routine MATERIALIZES it (copy-on-start): the routine and the session share
 * no rows, so in-session edits can never touch the preset. Validation mirrors
 * the DB CHECK constraints (079) so Postgres errors are never the first line
 * of defense.
 */

import { CATEGORIES, MAX_EXERCISES, type EntryExercise, type EntrySet } from './entries';

export interface RoutineExercise {
  name: string;
  exerciseKey: string | null; // catalog key; null = custom
  category: 'strength' | 'cardio' | 'mobility' | 'other';
  notes: string | null;
  /** Planned set count: starting a session seeds this many empty set rows. */
  targetSets: number;
}

export interface WorkoutRoutine {
  id: string;
  name: string;
  exercises: RoutineExercise[];
  createdAt: string;
  updatedAt: string;
}

export const MAX_ROUTINES = 30;
export const MAX_ROUTINE_EXERCISES = MAX_EXERCISES;
export const MAX_TARGET_SETS = 10;
export const MAX_ROUTINE_NAME = 120;

export function validateRoutinePayload(
  raw: unknown
): { ok: true; name: string; exercises: RoutineExercise[] } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'Malformed routine payload' };
  }
  const body = raw as Record<string, unknown>;
  if (
    typeof body.name !== 'string' ||
    body.name.trim().length === 0 ||
    body.name.trim().length > MAX_ROUTINE_NAME
  ) {
    return { ok: false, error: `Routine name must be 1–${MAX_ROUTINE_NAME} characters` };
  }
  if (!Array.isArray(body.exercises)) {
    return { ok: false, error: 'Exercises must be an array' };
  }
  if (body.exercises.length === 0) {
    return { ok: false, error: 'A routine needs at least one exercise' };
  }
  if (body.exercises.length > MAX_ROUTINE_EXERCISES) {
    return { ok: false, error: `Too many exercises (max ${MAX_ROUTINE_EXERCISES})` };
  }

  const exercises: RoutineExercise[] = [];
  for (let i = 0; i < body.exercises.length; i++) {
    const e = body.exercises[i];
    if (typeof e !== 'object' || e === null) {
      return { ok: false, error: `Exercise ${i + 1} is malformed` };
    }
    const ex = e as Record<string, unknown>;
    if (typeof ex.name !== 'string' || ex.name.trim().length === 0 || ex.name.trim().length > 80) {
      return { ok: false, error: `Exercise ${i + 1}: name must be 1–80 characters` };
    }
    if (ex.exerciseKey !== null && ex.exerciseKey !== undefined && typeof ex.exerciseKey !== 'string') {
      return { ok: false, error: `Exercise ${i + 1}: invalid exercise key` };
    }
    if (!CATEGORIES.includes(ex.category as typeof CATEGORIES[number])) {
      return { ok: false, error: `Exercise ${i + 1}: invalid category` };
    }
    if (ex.notes !== null && ex.notes !== undefined && (typeof ex.notes !== 'string' || ex.notes.length > 500)) {
      return { ok: false, error: `Exercise ${i + 1}: notes must be 500 characters or fewer` };
    }
    if (
      typeof ex.targetSets !== 'number' ||
      !Number.isInteger(ex.targetSets) ||
      ex.targetSets < 1 ||
      ex.targetSets > MAX_TARGET_SETS
    ) {
      return { ok: false, error: `Exercise ${i + 1}: sets must be 1–${MAX_TARGET_SETS}` };
    }
    exercises.push({
      name: ex.name.trim(),
      exerciseKey: (ex.exerciseKey as string | null) ?? null,
      category: ex.category as RoutineExercise['category'],
      notes: (ex.notes as string | null) ?? null,
      targetSets: ex.targetSets,
    });
  }

  return { ok: true, name: body.name.trim(), exercises };
}

/** Finish-flow conversion: strip set values, keep the count as the plan. */
export function entriesToRoutineExercises(exercises: EntryExercise[]): RoutineExercise[] {
  return exercises.map(exercise => ({
    name: exercise.name,
    exerciseKey: exercise.exerciseKey,
    category: exercise.category,
    notes: exercise.notes,
    targetSets: Math.min(Math.max(exercise.sets.length, 1), MAX_TARGET_SETS),
  }));
}

/** Materialization: each exercise becomes targetSets empty set rows. */
export function routineToEntries(exercises: RoutineExercise[]): EntryExercise[] {
  return exercises.map(exercise => ({
    name: exercise.name,
    exerciseKey: exercise.exerciseKey,
    category: exercise.category,
    notes: exercise.notes,
    sets: Array.from(
      { length: exercise.targetSets },
      (_, i): EntrySet => ({
        setNumber: i + 1,
        reps: null,
        weight: null,
        weightUnit: null,
        durationSeconds: null,
        distance: null,
        distanceUnit: null,
        completedAt: null,
        media: [],
      })
    ),
  }));
}

/** Supabase select for a routine with nested exercises (routes share it). */
export const ROUTINE_SELECT = `
  id, name, created_at, updated_at,
  exercises:workout_routine_exercises (
    name, exercise_key, category, position, notes, target_sets
  )
`;

export interface ServerRoutineExerciseRow {
  name: string;
  exercise_key: string | null;
  category: 'strength' | 'cardio' | 'mobility' | 'other';
  position: number;
  notes: string | null;
  target_sets: number;
}

export interface ServerRoutineRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  exercises?: ServerRoutineExerciseRow[];
}

export function serverToRoutine(row: ServerRoutineRow): WorkoutRoutine {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    exercises: [...(row.exercises ?? [])]
      .sort((a, b) => a.position - b.position)
      .map(exercise => ({
        name: exercise.name,
        exerciseKey: exercise.exercise_key,
        category: exercise.category,
        notes: exercise.notes,
        targetSets: exercise.target_sets,
      })),
  };
}
