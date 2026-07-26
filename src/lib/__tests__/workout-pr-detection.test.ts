import { describe, it, expect } from 'vitest';
import { detectPRs } from '../workouts/pr-detection';
import type { EntryExercise } from '../workouts/entries';

const set = (over: Partial<EntryExercise['sets'][number]> = {}): EntryExercise['sets'][number] => ({
  setNumber: 1,
  reps: null,
  weight: null,
  weightUnit: null,
  durationSeconds: null,
  distance: null,
  distanceUnit: null,
  completedAt: null,
  ...over,
});

const bench = (weight: number, unit: 'lbs' | 'kg' = 'lbs'): EntryExercise => ({
  name: 'Bench Press',
  exerciseKey: 'bench_press',
  category: 'strength',
  notes: null,
  sets: [set({ reps: 5, weight, weightUnit: unit })],
});

describe('detectPRs', () => {
  it('detects a weight PR that beats history', () => {
    const prs = detectPRs([bench(225)], [{ metric_key: 'bench_press', value: 205 }]);
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({ metricKey: 'bench_press', value: 225, previousBest: 205 });
  });

  it('equaling history is not a PR', () => {
    expect(detectPRs([bench(205)], [{ metric_key: 'bench_press', value: 205 }])).toHaveLength(0);
  });

  it('first-ever entry counts as a PR with null previousBest', () => {
    const prs = detectPRs([bench(135)], []);
    expect(prs[0].previousBest).toBeNull();
  });

  it('converts kg before comparing', () => {
    // 100 kg = 220.5 lbs > 205 lbs history
    const prs = detectPRs([bench(100, 'kg')], [{ metric_key: 'bench_press', value: 205 }]);
    expect(prs).toHaveLength(1);
    expect(prs[0].value).toBeCloseTo(220.5, 1);
  });

  it('pull-ups compare by reps', () => {
    const pullUps: EntryExercise = {
      name: 'Pull-Ups',
      exerciseKey: 'pull_ups',
      category: 'strength',
      notes: null,
      sets: [set({ reps: 15 })],
    };
    const prs = detectPRs([pullUps], [{ metric_key: 'pull_ups', value: 12 }]);
    expect(prs[0]).toMatchObject({ metricKey: 'pull_ups', value: 15 });
  });

  it('ignores unmapped and custom exercises', () => {
    const custom: EntryExercise = {
      name: 'Sled Push',
      exerciseKey: null,
      category: 'strength',
      notes: null,
      sets: [set({ reps: 5, weight: 400, weightUnit: 'lbs' })],
    };
    const unmapped: EntryExercise = {
      name: 'Bicep Curl',
      exerciseKey: 'bicep_curl',
      category: 'strength',
      notes: null,
      sets: [set({ reps: 10, weight: 40, weightUnit: 'lbs' })],
    };
    expect(detectPRs([custom, unmapped], [])).toHaveLength(0);
  });

  it('uses the best set across the workout, ignores null/zero values', () => {
    const workout: EntryExercise = {
      ...bench(185),
      sets: [
        set({ reps: 5, weight: 185, weightUnit: 'lbs' }),
        set({ setNumber: 2, reps: 1, weight: 235, weightUnit: 'lbs' }),
        set({ setNumber: 3, reps: 5, weight: 0, weightUnit: 'lbs' }),
      ],
    };
    const prs = detectPRs([workout], [{ metric_key: 'bench_press', value: 225 }, { metric_key: 'bench_press', value: null }]);
    expect(prs[0].value).toBe(235);
  });
});
