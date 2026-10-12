/**
 * Saved workout routines (presets) — a named, ordered exercise list with a
 * planned set count per exercise, no set values. Starting a session from a
 * routine MATERIALIZES it (copy-on-start): the routine and the session share
 * no rows, so in-session edits can never touch the preset. Validation mirrors
 * the DB CHECK constraints (079) so Postgres errors are never the first line
 * of defense.
 */

import { CATEGORIES, emptyEntrySet, GROUP_KINDS, healGroups, MAX_EXERCISES, MAX_GROUP_ROUNDS, type EntryExercise, type ExerciseGroupKind } from './entries';
import { isUuid } from '@/lib/uuid';
import { newId } from '@/lib/ids';

export interface RoutineExercise {
  name: string;
  exerciseKey: string | null; // catalog key; null = custom
  category: 'strength' | 'cardio' | 'mobility' | 'other';
  notes: string | null;
  /** Planned set count: starting a session seeds this many empty set rows. */
  targetSets: number;
  /** 260: a routine keeps its supersets and circuits (Tom, Oct 12 2026). Absent = a single exercise. */
  groupId?: string | null;
  groupKind?: ExerciseGroupKind | null;
  groupRounds?: number | null;
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
    if (ex.groupId !== undefined && ex.groupId !== null && (typeof ex.groupId !== 'string' || !isUuid(ex.groupId))) {
      return { ok: false, error: `Exercise ${i + 1}: invalid group id` };
    }
    if (ex.groupKind !== undefined && ex.groupKind !== null && !GROUP_KINDS.includes(ex.groupKind as ExerciseGroupKind)) {
      return { ok: false, error: `Exercise ${i + 1}: invalid group kind` };
    }
    if (ex.groupRounds !== undefined && ex.groupRounds !== null && (typeof ex.groupRounds !== 'number' || !Number.isInteger(ex.groupRounds) || ex.groupRounds < 1 || ex.groupRounds > MAX_GROUP_ROUNDS)) {
      return { ok: false, error: `Exercise ${i + 1}: rounds must be 1–${MAX_GROUP_ROUNDS}` };
    }
    exercises.push({
      name: ex.name.trim(),
      exerciseKey: (ex.exerciseKey as string | null) ?? null,
      category: ex.category as RoutineExercise['category'],
      notes: (ex.notes as string | null) ?? null,
      targetSets: ex.targetSets,
      ...(typeof ex.groupId === 'string'
        ? {
            groupId: ex.groupId,
            groupKind: GROUP_KINDS.includes(ex.groupKind as ExerciseGroupKind) ? (ex.groupKind as ExerciseGroupKind) : null,
            groupRounds: typeof ex.groupRounds === 'number' ? ex.groupRounds : null,
          }
        : {}),
    });
  }

  return { ok: true, name: body.name.trim(), exercises: healRoutineGroups(exercises) };
}

/** The group invariants on a routine, healed the same way as a workout's (entries.ts healGroups): a member's planned sets = the rounds. */
export function healRoutineGroups(exercises: RoutineExercise[]): RoutineExercise[] {
  if (!exercises.some(e => e.groupId || e.groupKind || e.groupRounds)) return exercises;
  const asEntries: EntryExercise[] = exercises.map((e, i) => ({
    clientId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    name: e.name,
    exerciseKey: e.exerciseKey,
    category: e.category,
    notes: e.notes,
    sets: Array.from({ length: e.targetSets }, (_, k) => emptyEntrySet(k + 1)),
    groupId: e.groupId ?? null,
    groupKind: e.groupKind ?? null,
    groupRounds: e.groupRounds ?? null,
  }));
  const healed = healGroups(asEntries);
  return healed.map(h => {
    const original = exercises[Number(h.clientId.slice(-12))];
    const grouped = !!h.groupId;
    return {
      name: original.name,
      exerciseKey: original.exerciseKey,
      category: original.category,
      notes: original.notes,
      targetSets: Math.min(MAX_TARGET_SETS, Math.max(1, grouped ? (h.groupRounds ?? h.sets.length) : original.targetSets)),
      ...(grouped ? { groupId: h.groupId!, groupKind: h.groupKind!, groupRounds: h.groupRounds! } : {}),
    };
  });
}

/** Finish-flow conversion: strip set values, keep the count as the plan (a group member's plan is its rounds). */
export function entriesToRoutineExercises(exercises: EntryExercise[]): RoutineExercise[] {
  return exercises.map(exercise => ({
    name: exercise.name,
    exerciseKey: exercise.exerciseKey,
    category: exercise.category,
    notes: exercise.notes,
    targetSets: Math.min(Math.max(exercise.groupId ? (exercise.groupRounds ?? exercise.sets.length) : exercise.sets.length, 1), MAX_TARGET_SETS),
    ...(exercise.groupId ? { groupId: exercise.groupId, groupKind: exercise.groupKind ?? null, groupRounds: exercise.groupRounds ?? null } : {}),
  }));
}

/**
 * Materialization: each exercise becomes targetSets empty set rows, with a
 * fresh client id (copy-on-start: the routine and the session share no ids)
 * and the group carried under a FRESH group id per start.
 */
export function routineToEntries(exercises: RoutineExercise[], mint: () => string = newId): EntryExercise[] {
  const groupIds = new Map<string, string>();
  return exercises.map(exercise => {
    const clientId = mint();
    const groupId = exercise.groupId ? (groupIds.get(exercise.groupId) ?? (groupIds.set(exercise.groupId, mint()), groupIds.get(exercise.groupId)!)) : null;
    return {
      clientId,
      name: exercise.name,
      exerciseKey: exercise.exerciseKey,
      category: exercise.category,
      notes: exercise.notes,
      sets: Array.from({ length: exercise.targetSets }, (_, i) => emptyEntrySet(i + 1)),
      groupId,
      groupKind: groupId ? (exercise.groupKind ?? null) : null,
      groupRounds: groupId ? (exercise.groupRounds ?? exercise.targetSets) : null,
    };
  });
}

/** Supabase select for a routine with nested exercises (routes share it). */
export const ROUTINE_SELECT = `
  id, name, created_at, updated_at,
  exercises:workout_routine_exercises (
    name, exercise_key, category, position, notes, target_sets, group_id, group_kind, group_rounds
  )
`;

export interface ServerRoutineExerciseRow {
  name: string;
  exercise_key: string | null;
  category: 'strength' | 'cardio' | 'mobility' | 'other';
  position: number;
  notes: string | null;
  target_sets: number;
  group_id?: string | null;
  group_kind?: ExerciseGroupKind | null;
  group_rounds?: number | null;
}

/** The routine row's group fields as the RoutineExercise carries them (absent when ungrouped — the pre-260 shape). */
export function routineGroupFields(row: Pick<ServerRoutineExerciseRow, 'group_id' | 'group_kind' | 'group_rounds'>): Pick<RoutineExercise, 'groupId' | 'groupKind' | 'groupRounds'> | Record<string, never> {
  return row.group_id ? { groupId: row.group_id, groupKind: row.group_kind ?? null, groupRounds: row.group_rounds ?? null } : {};
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
        ...routineGroupFields(exercise),
      })),
  };
}
