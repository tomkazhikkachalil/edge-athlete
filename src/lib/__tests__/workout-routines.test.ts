import { describe, it, expect } from 'vitest';
import { validateEntriesPayload, type EntryExercise } from '../workouts/entries';
import {
  validateRoutinePayload,
  entriesToRoutineExercises,
  routineToEntries,
  serverToRoutine,
  MAX_ROUTINE_EXERCISES,
  MAX_TARGET_SETS,
  MAX_ROUTINE_NAME,
  type RoutineExercise,
} from '../workouts/routines';

const validExercise = (name = 'Bench Press'): Record<string, unknown> => ({
  name,
  exerciseKey: 'bench_press',
  category: 'strength',
  notes: null,
  targetSets: 3,
});

const validPayload = (): Record<string, unknown> => ({
  name: 'Push Day',
  exercises: [validExercise(), validExercise('Overhead Press')],
});

describe('validateRoutinePayload', () => {
  it('accepts a valid payload and normalizes it', () => {
    const result = validateRoutinePayload(validPayload());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.name).toBe('Push Day');
      expect(result.exercises).toHaveLength(2);
      expect(result.exercises[0].targetSets).toBe(3);
    }
  });

  it('trims the routine and exercise names', () => {
    const result = validateRoutinePayload({
      name: '  Push Day  ',
      exercises: [{ ...validExercise('  Bench  ') }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.name).toBe('Push Day');
      expect(result.exercises[0].name).toBe('Bench');
    }
  });

  it('rejects malformed payloads', () => {
    expect(validateRoutinePayload(null).ok).toBe(false);
    expect(validateRoutinePayload('nope').ok).toBe(false);
    expect(validateRoutinePayload({ name: 'X', exercises: 'x' }).ok).toBe(false);
    expect(validateRoutinePayload({ name: 'X', exercises: [null] }).ok).toBe(false);
  });

  it('rejects bad routine names', () => {
    expect(validateRoutinePayload({ ...validPayload(), name: '' }).ok).toBe(false);
    expect(validateRoutinePayload({ ...validPayload(), name: '   ' }).ok).toBe(false);
    expect(validateRoutinePayload({ ...validPayload(), name: 'x'.repeat(MAX_ROUTINE_NAME + 1) }).ok).toBe(false);
    expect(validateRoutinePayload({ ...validPayload(), name: 42 }).ok).toBe(false);
  });

  it('rejects empty routines and over-cap exercise lists', () => {
    expect(validateRoutinePayload({ name: 'X', exercises: [] }).ok).toBe(false);
    const tooMany = Array.from({ length: MAX_ROUTINE_EXERCISES + 1 }, () => validExercise());
    expect(validateRoutinePayload({ name: 'X', exercises: tooMany }).ok).toBe(false);
  });

  it('rejects bad exercise fields', () => {
    expect(validateRoutinePayload({ name: 'X', exercises: [{ ...validExercise(), name: '' }] }).ok).toBe(false);
    expect(validateRoutinePayload({ name: 'X', exercises: [{ ...validExercise(), name: 'x'.repeat(81) }] }).ok).toBe(false);
    expect(validateRoutinePayload({ name: 'X', exercises: [{ ...validExercise(), category: 'yoga' }] }).ok).toBe(false);
    expect(validateRoutinePayload({ name: 'X', exercises: [{ ...validExercise(), exerciseKey: 42 }] }).ok).toBe(false);
    expect(validateRoutinePayload({ name: 'X', exercises: [{ ...validExercise(), notes: 'x'.repeat(501) }] }).ok).toBe(false);
  });

  it('rejects out-of-range targetSets', () => {
    for (const bad of [0, MAX_TARGET_SETS + 1, 2.5, null, undefined, '3']) {
      expect(validateRoutinePayload({ name: 'X', exercises: [{ ...validExercise(), targetSets: bad }] }).ok).toBe(false);
    }
  });

  it('accepts custom exercises (null key) and normalizes missing optionals', () => {
    const result = validateRoutinePayload({
      name: 'X',
      exercises: [{ name: 'Sled Push', category: 'other', targetSets: 2 }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.exercises[0].exerciseKey).toBeNull();
      expect(result.exercises[0].notes).toBeNull();
    }
  });
});

const entrySet = (n: number): EntryExercise['sets'][number] => ({
  setNumber: n,
  reps: 5,
  weight: 185,
  weightUnit: 'lbs',
  durationSeconds: null,
  distance: null,
  distanceUnit: null,
  completedAt: '2026-08-11T12:00:00.000Z',
  media: [{ url: '/uploads/clip.mp4', type: 'video' }],
});

describe('entriesToRoutineExercises', () => {
  it('strips set data and keeps the count as targetSets', () => {
    const entries: EntryExercise[] = [
      {
        name: 'Bench Press',
        exerciseKey: 'bench_press',
        category: 'strength',
        notes: 'pause reps',
        sets: [entrySet(1), entrySet(2), entrySet(3), entrySet(4)],
      },
    ];
    const result = entriesToRoutineExercises(entries);
    expect(result).toEqual([
      {
        name: 'Bench Press',
        exerciseKey: 'bench_press',
        category: 'strength',
        notes: 'pause reps',
        targetSets: 4,
      },
    ]);
  });

  it('clamps targetSets into [1, MAX_TARGET_SETS]', () => {
    const base: EntryExercise = {
      name: 'Run', exerciseKey: 'run', category: 'cardio', notes: null, sets: [],
    };
    expect(entriesToRoutineExercises([base])[0].targetSets).toBe(1);
    const many = { ...base, sets: Array.from({ length: 12 }, (_, i) => entrySet(i + 1)) };
    expect(entriesToRoutineExercises([many])[0].targetSets).toBe(MAX_TARGET_SETS);
  });

  it('preserves order', () => {
    const entries: EntryExercise[] = ['A', 'B', 'C'].map(name => ({
      name, exerciseKey: null, category: 'other', notes: null, sets: [entrySet(1)],
    }));
    expect(entriesToRoutineExercises(entries).map(e => e.name)).toEqual(['A', 'B', 'C']);
  });
});

describe('routineToEntries', () => {
  const routineExercise = (targetSets: number): RoutineExercise => ({
    name: 'Bench Press',
    exerciseKey: 'bench_press',
    category: 'strength',
    notes: null,
    targetSets,
  });

  it('seeds exactly targetSets empty sets with sequential numbers', () => {
    const [entry] = routineToEntries([routineExercise(3)]);
    expect(entry.sets).toHaveLength(3);
    expect(entry.sets.map(s => s.setNumber)).toEqual([1, 2, 3]);
    for (const set of entry.sets) {
      expect(set.reps).toBeNull();
      expect(set.weight).toBeNull();
      expect(set.weightUnit).toBeNull();
      expect(set.durationSeconds).toBeNull();
      expect(set.distance).toBeNull();
      expect(set.distanceUnit).toBeNull();
      expect(set.completedAt).toBeNull();
      expect(set.media).toEqual([]);
    }
  });

  it('round-trips through validateEntriesPayload', () => {
    const entries = routineToEntries([routineExercise(2), { ...routineExercise(1), exerciseKey: null, name: 'Sled Push' }]);
    const result = validateEntriesPayload(entries);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.exercises).toHaveLength(2);
      expect(result.exercises[0].sets).toHaveLength(2);
    }
  });
});

describe('serverToRoutine', () => {
  it('maps snake_case rows and sorts exercises by position', () => {
    const routine = serverToRoutine({
      id: 'r1',
      name: 'Push Day',
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-11T00:00:00.000Z',
      exercises: [
        { name: 'B', exercise_key: null, category: 'other', position: 1, notes: null, target_sets: 2 },
        { name: 'A', exercise_key: 'bench_press', category: 'strength', position: 0, notes: 'hi', target_sets: 5 },
      ],
    });
    expect(routine.id).toBe('r1');
    expect(routine.exercises.map(e => e.name)).toEqual(['A', 'B']);
    expect(routine.exercises[0]).toEqual({
      name: 'A', exerciseKey: 'bench_press', category: 'strength', notes: 'hi', targetSets: 5,
    });
  });

  it('tolerates a missing exercises embed', () => {
    const routine = serverToRoutine({
      id: 'r1', name: 'X',
      created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z',
    });
    expect(routine.exercises).toEqual([]);
  });
});
