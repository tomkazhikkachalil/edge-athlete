import { describe, it, expect } from 'vitest';
import {
  computeSummary,
  formatElapsed,
  formatDuration,
  formatVolume,
  formatSetLine,
  collectWorkoutMedia,
} from '../workouts/summary';
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
  media: [],
  ...over,
});

const exercise = (name: string, sets: EntryExercise['sets']): EntryExercise => ({
  name,
  exerciseKey: null,
  category: 'strength',
  notes: null,
  sets,
});

describe('computeSummary', () => {
  it('computes volume, counts, and top line', () => {
    const summary = computeSummary([
      exercise('Bench Press', [
        set({ setNumber: 1, reps: 5, weight: 185, weightUnit: 'lbs' }),
        set({ setNumber: 2, reps: 3, weight: 205, weightUnit: 'lbs' }),
      ]),
      exercise('Run', [set({ setNumber: 1, durationSeconds: 1800, distance: 3, distanceUnit: 'mi' })]),
    ]);
    expect(summary.exerciseCount).toBe(2);
    expect(summary.totalSets).toBe(3);
    expect(summary.totalVolumeLbs).toBe(5 * 185 + 3 * 205);
    expect(summary.topLine).toBe('Bench Press 205 lbs × 3');
    expect(summary.perExerciseBest['Bench Press'].maxWeightLbs).toBe(205);
  });

  it('converts kg to lbs for volume and comparisons', () => {
    const summary = computeSummary([
      exercise('Squat', [set({ setNumber: 1, reps: 2, weight: 100, weightUnit: 'kg' })]),
    ]);
    expect(summary.totalVolumeLbs).toBe(Math.round(2 * 100 * 2.20462));
    expect(summary.topLine).toBe('Squat 100 kg × 2');
  });

  it('ignores empty sets and cardio contributes no volume', () => {
    const summary = computeSummary([
      exercise('Plank', [set({ setNumber: 1 }), set({ setNumber: 2, durationSeconds: 60 })]),
    ]);
    expect(summary.totalSets).toBe(1);
    expect(summary.totalVolumeLbs).toBe(0);
    expect(summary.topLine).toBeNull();
  });

  it('handles an empty workout', () => {
    const summary = computeSummary([]);
    expect(summary).toMatchObject({ exerciseCount: 0, totalSets: 0, totalVolumeLbs: 0, topLine: null });
  });
});

describe('formatElapsed', () => {
  it('formats sub-hour and over-hour values', () => {
    expect(formatElapsed(59)).toBe('0:59');
    expect(formatElapsed(60)).toBe('1:00');
    expect(formatElapsed(3661)).toBe('1:01:01');
    expect(formatElapsed(-5)).toBe('0:00');
  });
});

describe('formatDuration', () => {
  it('formats human durations', () => {
    expect(formatDuration(45)).toBe('1 min');
    expect(formatDuration(47 * 60)).toBe('47 min');
    expect(formatDuration(3600)).toBe('1 h');
    expect(formatDuration(3720)).toBe('1 h 2 min');
  });
});

describe('formatVolume', () => {
  it('formats with thousands separators', () => {
    expect(formatVolume(12450)).toBe('12,450 lbs');
  });
});

describe('formatSetLine', () => {
  it('joins present fields, dash for empty', () => {
    expect(formatSetLine(set({ reps: 5, weight: 185, weightUnit: 'lbs' }))).toBe('5 reps × 185 lbs');
    expect(formatSetLine(set({ durationSeconds: 180 }))).toBe('3:00');
    expect(formatSetLine(set({ distance: 3, distanceUnit: 'mi', durationSeconds: 1440 }))).toBe('24:00 × 3 mi');
    expect(formatSetLine(set())).toBe('—');
  });
});

describe('collectWorkoutMedia', () => {
  it('collects in exercise-then-set order with context', () => {
    const media = collectWorkoutMedia([
      exercise('Bench Press', [
        set({ setNumber: 1, media: [{ url: 'https://x/a.mp4', type: 'video' }] }),
        set({ setNumber: 2, media: [{ url: 'https://x/b.jpg', type: 'image' }, { url: 'https://x/c.jpg', type: 'image' }] }),
      ]),
      exercise('Squat', [set({ setNumber: 1, media: [{ url: 'https://x/d.mp4', type: 'video' }] })]),
    ]);
    expect(media.map(m => m.url)).toEqual(['https://x/a.mp4', 'https://x/b.jpg', 'https://x/c.jpg', 'https://x/d.mp4']);
    expect(media[0]).toMatchObject({ exerciseName: 'Bench Press', setNumber: 1, type: 'video' });
  });

  it('returns empty for media-less workouts', () => {
    expect(collectWorkoutMedia([exercise('Bench Press', [set({ reps: 5 })])])).toEqual([]);
  });
});
