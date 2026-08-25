import { describe, it, expect } from 'vitest';
import {
  activeDaysThisWeek,
  weeklyBars,
  metricMilestones,
  isRecentPB,
} from '../vitals/derive';
import type { ServerWorkoutSession } from '../workouts/serialize';

// Fixed "now": Wednesday 2026-08-05 12:00 local (same anchor as the
// dashboard tests — Monday of this week is 2026-08-03).
const NOW = new Date(2026, 7, 5, 12, 0, 0);

let idCounter = 0;
const session = (
  startedAt: string,
  over: Partial<ServerWorkoutSession> = {},
  exercises: Array<{
    name: string; exercise_key: string | null;
    sets: Array<{ set_number: number; reps?: number | null; weight?: number | null; weight_unit?: 'lbs' | 'kg' | null }>;
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
      duration_seconds: null, distance: null, distance_unit: null,
      completed_at: null, media: [],
    })),
  })) as ServerWorkoutSession['exercises'],
  ...over,
});

const vital = (
  metric_key: string,
  value: number | null,
  recorded_at: string,
  value_display: string | null = null
) => ({ metric_key, value, recorded_at, value_display });

describe('activeDaysThisWeek', () => {
  it('counts distinct local days; two sessions one day count once', () => {
    const sessions = [
      session('2026-08-03T07:00:00'),
      session('2026-08-03T18:00:00'), // same Monday
      session('2026-08-04T10:00:00'),
    ];
    expect(activeDaysThisWeek(sessions, NOW)).toBe(2);
  });

  it('ignores prior weeks and non-completed sessions', () => {
    const sessions = [
      session('2026-07-30T10:00:00'), // prior week
      session('2026-08-04T10:00:00', { status: 'active' }),
      session('2026-08-04T11:00:00'),
    ];
    expect(activeDaysThisWeek(sessions, NOW)).toBe(1);
  });

  it('is 0 with no training this week', () => {
    expect(activeDaysThisWeek([session('2026-07-28T10:00:00')], NOW)).toBe(0);
  });
});

describe('weeklyBars', () => {
  it('returns oldest-first Monday buckets with only the last marked current', () => {
    const bars = weeklyBars([], 4, NOW);
    expect(bars.map(b => b.weekStart)).toEqual([
      '2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03',
    ]);
    expect(bars.map(b => b.isCurrent)).toEqual([false, false, false, true]);
  });

  it('buckets totals per week; empty weeks stay zero; kg converts', () => {
    const sessions = [
      session('2026-08-04T10:00:00', {}, [
        { name: 'Bench', exercise_key: 'bench_press', sets: [{ set_number: 1, reps: 5, weight: 100, weight_unit: 'kg' }] },
      ]),
      session('2026-07-21T10:00:00', { duration_seconds: 1800 }),
      session('2026-07-22T10:00:00', { duration_seconds: 600 }),
    ];
    const bars = weeklyBars(sessions, 4, NOW);
    expect(bars[3]).toMatchObject({ workouts: 1, volumeLbs: Math.round(5 * 100 * 2.20462) });
    expect(bars[1]).toMatchObject({ workouts: 2, seconds: 2400 });
    expect(bars[2]).toMatchObject({ workouts: 0, volumeLbs: 0, seconds: 0 });
  });

  it('excludes sessions older than the window and non-completed ones', () => {
    const sessions = [
      session('2026-06-01T10:00:00'),
      session('2026-08-04T10:00:00', { status: 'active' }),
    ];
    const bars = weeklyBars(sessions, 4, NOW);
    expect(bars.every(b => b.workouts === 0)).toBe(true);
  });
});

describe('metricMilestones', () => {
  it('keeps entries that set or tie the running best (higher is better)', () => {
    const vitals = [
      vital('bench_press', 185, '2025-09-01'),
      vital('bench_press', 175, '2025-10-01'), // regression — not a milestone
      vital('bench_press', 185, '2025-11-01'), // tie — counts, matching latestPB
      vital('bench_press', 225, '2026-08-01'),
    ];
    const ms = metricMilestones(vitals, 'bench_press');
    expect(ms.map(m => m.value)).toEqual([185, 185, 225]);
    expect(ms[2].display).toBe('225 lbs');
  });

  it('respects lower-is-better and mm:ss display', () => {
    const vitals = [
      vital('mile_run', 372, '2025-11-01', '6:12'),
      vital('mile_run', 390, '2026-01-01'), // slower — not a milestone
      vital('mile_run', 348, '2026-07-15'), // no display → formatted mm:ss
    ];
    const ms = metricMilestones(vitals, 'mile_run');
    expect(ms.map(m => m.display)).toEqual(['6:12', '5:48']);
  });

  it('returns nothing for body metrics and unknown keys', () => {
    expect(metricMilestones([vital('height', 72, '2026-01-01')], 'height')).toEqual([]);
    expect(metricMilestones([vital('made_up', 1, '2026-01-01')], 'made_up')).toEqual([]);
  });

  it('sorts out-of-order input by date before walking', () => {
    const vitals = [
      vital('bench_press', 225, '2026-08-01'),
      vital('bench_press', 185, '2025-09-01'),
    ];
    expect(metricMilestones(vitals, 'bench_press').map(m => m.value)).toEqual([185, 225]);
  });
});

describe('isRecentPB', () => {
  it('is true within the window, false outside it', () => {
    expect(isRecentPB('2026-08-03', NOW)).toBe(true);
    expect(isRecentPB('2026-07-20', NOW)).toBe(false);
  });

  it('tolerates a date-only timestamp slightly ahead of local now', () => {
    // UTC midnight of "today" can be ahead of a west-of-UTC local clock.
    expect(isRecentPB('2026-08-05', NOW)).toBe(true);
  });

  it('honors a custom window', () => {
    expect(isRecentPB('2026-07-20', NOW, 30)).toBe(true);
  });
});
