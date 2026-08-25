import { describe, it, expect } from 'vitest';
import {
  buildWorkoutStatsData,
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
    // Keyed on exercise_key ?? normalized name (free-text must not fork lifts)
    expect(summary.perExerciseBest['bench press'].maxWeightLbs).toBe(205);
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

describe('buildWorkoutStatsData', () => {
  const summary = {
    exerciseCount: 3,
    totalSets: 11,
    totalVolumeLbs: 12450,
    topLine: 'Bench Press 185 lbs × 5',
    perExerciseBest: {},
  };

  it('builds the feed payload WorkoutPostCard reads', () => {
    expect(
      buildWorkoutStatsData({ sessionId: 'w1', title: 'Push Day', durationSeconds: 2832, summary })
    ).toEqual({
      type: 'workout_session',
      workout_session_id: 'w1',
      title: 'Push Day',
      duration_seconds: 2832,
      exercise_count: 3,
      total_sets: 11,
      total_volume_lbs: 12450,
      top_line: 'Bench Press 185 lbs × 5',
    });
  });

  it('falls back to "Workout" for a null or blank title', () => {
    expect(buildWorkoutStatsData({ sessionId: 'w1', title: null, durationSeconds: 60, summary }).title).toBe('Workout');
    expect(buildWorkoutStatsData({ sessionId: 'w1', title: '   ', durationSeconds: 60, summary }).title).toBe('Workout');
  });

  it('carries an empty workout through without inventing values', () => {
    const empty = { exerciseCount: 0, totalSets: 0, totalVolumeLbs: 0, topLine: null, perExerciseBest: {} };
    const out = buildWorkoutStatsData({ sessionId: 'w2', title: 'Rest', durationSeconds: 0, summary: empty });
    expect(out.exercise_count).toBe(0);
    expect(out.total_volume_lbs).toBe(0);
    expect(out.top_line).toBeNull();
  });

  it('includes prs only when non-empty — old-post shape stays identical', () => {
    const withPRs = buildWorkoutStatsData({
      sessionId: 'w1', title: 'Push', durationSeconds: 60, summary,
      prs: [{ label: 'Bench Press', display: '225 lbs' }],
    });
    expect(withPRs.prs).toEqual([{ label: 'Bench Press', display: '225 lbs' }]);

    const withEmpty = buildWorkoutStatsData({
      sessionId: 'w1', title: 'Push', durationSeconds: 60, summary, prs: [],
    });
    expect('prs' in withEmpty).toBe(false);
    const without = buildWorkoutStatsData({ sessionId: 'w1', title: 'Push', durationSeconds: 60, summary });
    expect('prs' in without).toBe(false);
  });
});
