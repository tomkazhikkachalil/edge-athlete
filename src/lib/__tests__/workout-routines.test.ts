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
        clientId: 'c-bench',
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
      clientId: 'c-run', name: 'Run', exerciseKey: 'run', category: 'cardio', notes: null, sets: [],
    };
    expect(entriesToRoutineExercises([base])[0].targetSets).toBe(1);
    const many = { ...base, sets: Array.from({ length: 12 }, (_, i) => entrySet(i + 1)) };
    expect(entriesToRoutineExercises([many])[0].targetSets).toBe(MAX_TARGET_SETS);
  });

  it('preserves order', () => {
    const entries: EntryExercise[] = ['A', 'B', 'C'].map(name => ({
      clientId: `c-${name}`, name, exerciseKey: null, category: 'other', notes: null, sets: [entrySet(1)],
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

// ── Workout screen program PR 1 (260): a routine keeps its supersets and circuits (Tom, Oct 12 2026) ──
import fs from 'node:fs';
import path from 'node:path';
import { healRoutineGroups, routineGroupFields } from '../workouts/routines';

const G = '44444444-4444-4444-8444-444444444444';

describe('routines keep groups (260)', () => {
  it('entriesToRoutineExercises carries the group and plans a member\'s sets as its rounds; an ungrouped exercise keeps the old shape exactly', () => {
    const out = entriesToRoutineExercises([
      { clientId: 'a', name: 'Squat', exerciseKey: 'squat', category: 'strength', notes: null, sets: [entrySet(1), entrySet(2), entrySet(3)], groupId: G, groupKind: 'circuit', groupRounds: 3 },
      { clientId: 'b', name: 'Push-up', exerciseKey: null, category: 'strength', notes: null, sets: [entrySet(1), entrySet(2), entrySet(3)], groupId: G, groupKind: 'circuit', groupRounds: 3 },
      { clientId: 'c', name: 'Plank', exerciseKey: null, category: 'other', notes: null, sets: [entrySet(1)] },
    ]);
    expect(out[0]).toEqual({ name: 'Squat', exerciseKey: 'squat', category: 'strength', notes: null, targetSets: 3, groupId: G, groupKind: 'circuit', groupRounds: 3 });
    expect(out[2]).toEqual({ name: 'Plank', exerciseKey: null, category: 'other', notes: null, targetSets: 1 });
  });
  it('routineToEntries mints fresh exercise ids and ONE fresh group id per group (copy-on-start)', () => {
    let n = 0;
    const mint = () => `id-${++n}`;
    const out = routineToEntries([
      { name: 'Squat', exerciseKey: 'squat', category: 'strength', notes: null, targetSets: 3, groupId: G, groupKind: 'circuit', groupRounds: 3 },
      { name: 'Push-up', exerciseKey: null, category: 'strength', notes: null, targetSets: 3, groupId: G, groupKind: 'circuit', groupRounds: 3 },
      { name: 'Plank', exerciseKey: null, category: 'other', notes: null, targetSets: 2 },
    ], mint);
    expect(out.map(e => e.clientId)).toEqual(['id-1', 'id-3', 'id-4']);
    expect(out[0].groupId).toBe('id-2');
    expect(out[1].groupId).toBe('id-2');
    expect(out[0]).toMatchObject({ groupKind: 'circuit', groupRounds: 3 });
    expect(out[2]).toMatchObject({ groupId: null, groupKind: null, groupRounds: null });
    expect(out[0].sets).toHaveLength(3);
  });
  it('validateRoutinePayload carries and heals the group fields; the old payload shape is unchanged', () => {
    const r = validateRoutinePayload({ name: 'Legs', exercises: [
      { name: 'A', exerciseKey: null, category: 'strength', notes: null, targetSets: 2, groupId: G, groupKind: 'superset', groupRounds: 4 },
      { name: 'B', exerciseKey: null, category: 'strength', notes: null, targetSets: 1, groupId: G, groupKind: 'superset', groupRounds: 4 },
    ] });
    expect(r.ok && r.exercises.map(e => e.targetSets)).toEqual([4, 4]);
    expect(r.ok && r.exercises[1]).toMatchObject({ groupId: G, groupKind: 'superset', groupRounds: 4 });
    const old = validateRoutinePayload({ name: 'Old', exercises: [{ name: 'A', exerciseKey: null, category: 'strength', notes: null, targetSets: 2 }] });
    expect(old.ok && old.exercises[0]).toEqual({ name: 'A', exerciseKey: null, category: 'strength', notes: null, targetSets: 2 });
    expect(validateRoutinePayload({ name: 'Bad', exercises: [{ name: 'A', exerciseKey: null, category: 'strength', notes: null, targetSets: 2, groupKind: 'pyramid' }] }).ok).toBe(false);
  });
  it('a singleton group in a routine is ungrouped by the healer', () => {
    const out = healRoutineGroups([{ name: 'A', exerciseKey: null, category: 'strength', notes: null, targetSets: 2, groupId: G, groupKind: 'circuit', groupRounds: 3 }]);
    expect(out[0]).toEqual({ name: 'A', exerciseKey: null, category: 'strength', notes: null, targetSets: 2 });
  });
  it('serverToRoutine carries the row\'s group fields and omits them for an ungrouped row (the pre-260 shape)', () => {
    expect(routineGroupFields({ group_id: G, group_kind: 'circuit', group_rounds: 3 })).toEqual({ groupId: G, groupKind: 'circuit', groupRounds: 3 });
    expect(routineGroupFields({ group_id: null, group_kind: null, group_rounds: null })).toEqual({});
    expect(routineGroupFields({})).toEqual({});
  });
  it('every explicit routine select and insert names the group columns', () => {
    for (const f of ['src/lib/workouts/routines.ts', 'src/lib/calendar/event-routine.ts', 'src/app/api/workouts/route.ts', 'src/app/api/calendar/events/route.ts', 'src/app/api/calendar/events/[id]/route.ts']) {
      expect(fs.readFileSync(path.join(process.cwd(), f), 'utf8'), f).toMatch(/target_sets, group_id, group_kind, group_rounds/);
    }
    for (const f of ['src/app/api/workout-routines/route.ts', 'src/app/api/workout-routines/[id]/route.ts']) {
      expect(fs.readFileSync(path.join(process.cwd(), f), 'utf8'), f).toMatch(/group_rounds: exercise\.groupRounds \?\? null/);
    }
  });
});
