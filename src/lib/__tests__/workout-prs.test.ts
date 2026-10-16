import { describe, expect, it } from 'vitest';
import { bestsOf, epley, foldBests, formatPr, newPRs, workoutUnit } from '../workouts/prs';
import type { EntryExercise, EntrySet } from '../workouts/entries';

const set = (reps: number | null, weight: number | null, unit: 'lbs' | 'kg' | null = 'lbs'): EntrySet => ({
  setNumber: 1,
  reps,
  weight,
  weightUnit: weight === null ? null : unit,
  durationSeconds: null,
  distance: null,
  distanceUnit: null,
  completedAt: null,
  media: [],
});
const ex = (name: string, key: string | null, sets: EntrySet[]): EntryExercise => ({ clientId: name, name, exerciseKey: key, category: 'strength', notes: null, sets });

describe('Epley', () => {
  it('a single is itself; 5 reps add a sixth; past 12 there is none', () => {
    expect(epley(225, 1)).toBe(225);
    expect(epley(200, 5)).toBeCloseTo(233.33, 1);
    expect(epley(100, 13)).toBeNull();
    expect(epley(0, 5)).toBeNull();
  });
});

describe('bests and records', () => {
  const lastWeek = bestsOf([ex('Bench Press', 'bench_press', [set(5, 185), set(3, 205)]), ex('Pull-ups', 'pullups', [set(10, null)])]);
  const twoWeeks = bestsOf([ex('bench press', null, [set(1, 215)])]);
  const history = foldBests([lastWeek, twoWeeks]);

  it('folds every session into all-time bests, a lift by key or by name', () => {
    expect(history.get('bench_press')).toMatchObject({ heaviest: 205, reps: null });
    expect(history.get('bench press')).toMatchObject({ heaviest: 215, e1rm: 215 });
    expect(history.get('pullups')).toMatchObject({ reps: 10, heaviest: null });
  });

  it('a new best is a record; equal is not; a first-ever lift is a baseline', () => {
    const today = bestsOf([
      ex('Bench Press', 'bench_press', [set(5, 195), set(1, 205)]), // e1rm 227.5 > 218.7; heaviest equal
      ex('Pull-ups', 'pullups', [set(12, null)]),
      ex('Deadlift', 'deadlift', [set(5, 315)]),
    ]);
    const hits = newPRs(today, history);
    expect(hits.map(h => [h.exerciseId, h.kind])).toEqual([
      ['bench_press', 'e1rm'], // volume 1,180 lb is below last week's 1,540: no record
      ['pullups', 'reps'],
    ]);
    expect(hits.find(h => h.kind === 'reps')).toMatchObject({ value: 12, previous: 10 });
  });

  it('mixes kg and lb through the one conversion', () => {
    const kg = bestsOf([ex('Squat', 'squat', [set(1, 100, 'kg')])]);
    expect(kg.get('squat')!.heaviest).toBeCloseTo(220.46, 1);
    const hist = bestsOf([ex('Squat', 'squat', [set(1, 220, 'lbs')])]);
    expect(newPRs(kg, hist).map(h => h.kind)).toEqual(['heaviest', 'e1rm', 'volume']);
  });

  it('reads a record in the workout’s own unit', () => {
    expect(formatPr('heaviest', 220.462, 'kg')).toBe('100 kg');
    expect(formatPr('heaviest', 225, 'lb')).toBe('225 lbs');
    expect(formatPr('heaviest', 225, 'lb', true)).toBe('225');
    expect(formatPr('reps', 12, 'lb', true)).toBe('12');
    expect(formatPr('reps', 12, 'kg')).toBe('12 reps');
    expect(workoutUnit([ex('Squat', 'squat', [set(5, 100, 'kg'), set(5, 100, 'kg'), set(5, 225, 'lbs')])])).toBe('kg');
    expect(workoutUnit([])).toBe('lb');
  });
});
