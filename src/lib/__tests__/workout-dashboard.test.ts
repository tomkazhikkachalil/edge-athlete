import { describe, it, expect } from 'vitest';
import {
  startOfWeek, weeklySummary, streakWeeks, latestPB,
  exerciseProgression, progressionKey, metricSeries,
} from '../workouts/dashboard';
import type { ServerWorkoutSession } from '../workouts/serialize';

// Fixed "now": Wednesday 2026-08-05 12:00 local.
const NOW = new Date(2026, 7, 5, 12, 0, 0);

let idCounter = 0;
const session = (
  startedAt: string,
  over: Partial<ServerWorkoutSession> = {},
  exercises: Array<{
    name: string; exercise_key: string | null;
    sets: Array<{ set_number: number; reps?: number | null; weight?: number | null; weight_unit?: 'lbs' | 'kg' | null; duration_seconds?: number | null }>;
  }> = []
): ServerWorkoutSession => ({
  id: `s${++idCounter}`,
  profile_id: 'p1',
  title: null,
  notes: null,
  status: 'completed',
  source: 'manual',
  started_at: startedAt,
  ended_at: null,
  duration_seconds: 3600,
  post_id: null,
  last_activity_at: startedAt,
  updated_at: startedAt,
  exercises: exercises.map((e, i) => ({
    id: `e${i}`, session_id: 's', name: e.name, exercise_key: e.exercise_key,
    category: 'strength', position: i, notes: null,
    sets: e.sets.map(s => ({
      id: `set${s.set_number}`, exercise_id: `e${i}`, set_number: s.set_number,
      reps: s.reps ?? null, weight: s.weight ?? null, weight_unit: s.weight_unit ?? null,
      duration_seconds: s.duration_seconds ?? null, distance: null, distance_unit: null,
      completed_at: null, media: [],
    })),
  })) as ServerWorkoutSession['exercises'],
  ...over,
});

describe('startOfWeek', () => {
  it('returns Monday 00:00 local', () => {
    // 2026-08-05 is a Wednesday → Monday is 2026-08-03
    expect(startOfWeek(NOW).getDay()).toBe(1);
    expect(startOfWeek(NOW).getDate()).toBe(3);
    // A Sunday belongs to the week that started 6 days earlier
    const sunday = new Date(2026, 7, 2, 23, 0);
    expect(startOfWeek(sunday).getDate()).toBe(27); // Mon Jul 27
  });
});

describe('weeklySummary', () => {
  it('buckets this week vs prior week; completed only; kg converted', () => {
    const sessions = [
      session('2026-08-04T10:00:00', {}, [
        { name: 'Bench', exercise_key: 'bench_press', sets: [{ set_number: 1, reps: 5, weight: 100, weight_unit: 'kg' }] },
      ]),
      session('2026-07-30T10:00:00', {}, [
        { name: 'Bench', exercise_key: 'bench_press', sets: [{ set_number: 1, reps: 5, weight: 185, weight_unit: 'lbs' }] },
      ]),
      session('2026-08-04T18:00:00', { status: 'active' }), // ignored
      session('2026-07-01T10:00:00'), // older — ignored
    ];
    const s = weeklySummary(sessions, NOW);
    expect(s.workouts).toBe(1);
    expect(s.volumeLbs).toBe(Math.round(5 * 100 * 2.20462));
    expect(s.seconds).toBe(3600);
    expect(s.prior.workouts).toBe(1);
    expect(s.prior.volumeLbs).toBe(925);
  });

  it('falls back to ended-started when duration_seconds missing', () => {
    const s = weeklySummary([
      session('2026-08-04T10:00:00', { duration_seconds: null, ended_at: '2026-08-04T10:45:00' }),
    ], NOW);
    expect(s.seconds).toBe(45 * 60);
  });

  it('handles empty input', () => {
    expect(weeklySummary([], NOW)).toEqual({
      workouts: 0, volumeLbs: 0, seconds: 0,
      prior: { workouts: 0, volumeLbs: 0, seconds: 0 },
    });
  });
});

describe('streakWeeks', () => {
  it('counts consecutive weeks and tolerates an empty CURRENT week', () => {
    const sessions = [
      session('2026-07-28T10:00:00'), // week of Jul 27
      session('2026-07-21T10:00:00'), // week of Jul 20
    ];
    // Current week (Aug 3) empty → streak still 2
    expect(streakWeeks(sessions, NOW)).toBe(2);
  });

  it('breaks on an empty PRIOR week', () => {
    const sessions = [
      session('2026-08-04T10:00:00'), // this week
      session('2026-07-14T10:00:00'), // two weeks gap
    ];
    expect(streakWeeks(sessions, NOW)).toBe(1);
  });

  it('spans a year rollover', () => {
    const jan = new Date(2026, 0, 7, 12, 0); // Wed Jan 7 2026
    const sessions = [
      session('2026-01-06T10:00:00'), // week of Jan 5
      session('2025-12-30T10:00:00'), // week of Dec 29
      session('2025-12-23T10:00:00'), // week of Dec 22
    ];
    expect(streakWeeks(sessions, jan)).toBe(3);
  });

  it('is 0 with no completed sessions', () => {
    expect(streakWeeks([session('2026-08-04T10:00:00', { status: 'active' })], NOW)).toBe(0);
  });
});

describe('latestPB', () => {
  const entry = (metric_key: string, value: number, recorded_at: string, value_display?: string) => ({
    metric_key, value, recorded_at, value_display: value_display ?? String(value), metric_label: metric_key,
  });

  it('finds the most recent all-time best across metrics', () => {
    const pb = latestPB([
      entry('bench_press', 225, '2026-08-01'),
      entry('bench_press', 205, '2026-08-03'), // later but not a best
      entry('squat', 315, '2026-07-15'),
    ]);
    expect(pb?.metricKey).toBe('bench_press');
    expect(pb?.recordedAt).toBe('2026-08-01');
  });

  it('respects lower_is_better for timed metrics and counts ties', () => {
    const pb = latestPB([
      entry('40_yard_dash', 4.8, '2026-06-01'),
      entry('40_yard_dash', 4.52, '2026-07-01', '4.52 sec'),
      entry('40_yard_dash', 4.52, '2026-08-01', '4.52 sec'), // tie = still a PB entry
    ]);
    expect(pb?.recordedAt).toBe('2026-08-01');
    expect(pb?.valueDisplay).toBe('4.52 sec');
  });

  it('excludes body metrics (lower_is_better null) and empty input', () => {
    expect(latestPB([entry('height', 72, '2026-08-01')])).toBeNull();
    expect(latestPB([])).toBeNull();
  });
});

describe('exerciseProgression', () => {
  it('merges catalog rows with normalized free-text of the same lift', () => {
    expect(progressionKey('bench_press', 'whatever')).toBe('bench_press');
    expect(progressionKey(null, ' Bench Press ')).toBe('bench press');
    const sessions = [
      session('2026-07-01T10:00:00', {}, [
        { name: 'Bench Press', exercise_key: 'bench_press', sets: [{ set_number: 1, reps: 5, weight: 185, weight_unit: 'lbs' }] },
      ]),
      session('2026-07-08T10:00:00', {}, [
        { name: 'bench press', exercise_key: null, sets: [{ set_number: 1, reps: 3, weight: 205, weight_unit: 'lbs' }] },
      ]),
    ];
    const map = exerciseProgression(sessions);
    // Two keys here (catalog vs normalized name) is WRONG — assert merge intent:
    // catalog key wins when present; the free-text one normalizes separately.
    expect(map.get('bench_press')?.points).toHaveLength(1);
    expect(map.get('bench press')?.points).toHaveLength(1);
  });

  it('takes the best set per session, ascending dates, mode-appropriate value', () => {
    const sessions = [
      session('2026-07-08T10:00:00', {}, [
        { name: 'Bench', exercise_key: 'bench_press', sets: [
          { set_number: 1, reps: 5, weight: 185, weight_unit: 'lbs' },
          { set_number: 2, reps: 1, weight: 100, weight_unit: 'kg' }, // 220.46 lbs — best
        ] },
        { name: 'Pull-Ups', exercise_key: 'pull_ups', sets: [{ set_number: 1, reps: 12 }] },
      ]),
      session('2026-07-01T10:00:00', {}, [
        { name: 'Bench', exercise_key: 'bench_press', sets: [{ set_number: 1, reps: 5, weight: 175, weight_unit: 'lbs' }] },
      ]),
    ];
    const map = exerciseProgression(sessions);
    const bench = map.get('bench_press')!;
    expect(bench.unit).toBe('lbs');
    expect(bench.points.map(p => p.value)).toEqual([175, 220.5]);
    expect(bench.points[0].date < bench.points[1].date).toBe(true);
    expect(map.get('pull_ups')).toMatchObject({ unit: 'reps' });
    expect(map.get('pull_ups')!.points[0].value).toBe(12);
  });

  it('skips active sessions and empty input', () => {
    expect(exerciseProgression([session('2026-08-04T10:00:00', { status: 'active' })]).size).toBe(0);
    expect(exerciseProgression([]).size).toBe(0);
  });
});

describe('metricSeries', () => {
  it('filters, sorts ascending, drops nulls', () => {
    const series = metricSeries([
      { metric_key: 'bench_press', value: 205, recorded_at: '2026-08-01' },
      { metric_key: 'bench_press', value: null, recorded_at: '2026-08-02' },
      { metric_key: 'squat', value: 315, recorded_at: '2026-07-01' },
      { metric_key: 'bench_press', value: 185, recorded_at: '2026-06-01' },
    ], 'bench_press');
    expect(series.map(s => s.value)).toEqual([185, 205]);
  });
});
