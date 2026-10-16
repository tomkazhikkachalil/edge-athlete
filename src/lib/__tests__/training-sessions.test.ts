import { describe, expect, it } from 'vitest';
import {
  fromActivity,
  mergeSessions,
  sessionsActiveDays,
  sessionsStreakWeeks,
  sessionsWeeklyBars,
  sessionsWeeklySummary,
  type ActivitySession,
} from '../training/sessions';
import type { ServerWorkoutSession } from '../workouts/serialize';

// Oct 1 2026: a run from a watch counts in Training. Until then the week, the
// streak and the active-days ring counted completed gym workouts only.

// Local-time constructor throughout — the buckets are the viewer's local weeks.
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();
const NOW = new Date(2026, 9, 1, 15); // Thu Oct 1 2026 — the week began Mon Sep 28

const workout = (id: string, startedAt: string, over: Partial<ServerWorkoutSession> = {}): ServerWorkoutSession => ({
  id,
  profile_id: 'p1',
  title: 'Legs',
  notes: null,
  status: 'completed',
  source: 'live',
  started_at: startedAt,
  ended_at: null,
  duration_seconds: 3600,
  post_id: null,
  last_activity_at: startedAt,
  updated_at: startedAt,
  ...over,
});
const run = (id: string, startedAt: string, over: Partial<ActivitySession> = {}): ActivitySession => ({
  id,
  type: 'run',
  name: 'Morning run',
  startedAt,
  elapsedS: 2000,
  movingS: 1800,
  distanceM: 5000,
  ...over,
});

describe('fromActivity', () => {
  it('moving time where known, else elapsed; no lifted volume', () => {
    expect(fromActivity(run('a1', at(2026, 10, 1)))).toMatchObject({ kind: 'activity', seconds: 1800, volumeLbs: 0, title: 'Morning run', activityType: 'run', distanceM: 5000 });
    expect(fromActivity(run('a2', at(2026, 10, 1), { movingS: null })).seconds).toBe(2000);
  });
});

describe('mergeSessions', () => {
  it('completed workouts and activities, newest first; an active workout is not a session', () => {
    const merged = mergeSessions(
      [workout('w1', at(2026, 9, 29)), workout('w-live', at(2026, 10, 1, 14), { status: 'active' })],
      [run('a1', at(2026, 9, 30)), run('a2', at(2026, 9, 28))]
    );
    expect(merged.map(s => s.id)).toEqual(['a1', 'w1', 'a2']);
    expect(merged.map(s => s.kind)).toEqual(['activity', 'workout', 'activity']);
  });
});

describe('the week counts both kinds', () => {
  const sessions = mergeSessions(
    [workout('w1', at(2026, 9, 29))], // Tue this week
    [
      run('a1', at(2026, 9, 30)), // Wed this week
      run('a2', at(2026, 9, 30, 18)), // Wed again — one active day
      run('a3', at(2026, 9, 23)), // last week
    ]
  );

  it('summary: three sessions this week, time added across kinds, one last week', () => {
    const s = sessionsWeeklySummary(sessions, NOW);
    expect(s.workouts).toBe(3);
    expect(s.seconds).toBe(3600 + 1800 + 1800);
    expect(s.prior.workouts).toBe(1);
  });

  it('active days: two distinct days, though three sessions', () => {
    expect(sessionsActiveDays(sessions, NOW)).toBe(2);
  });

  it('bars: the run-only week before is a real bar, not a gap', () => {
    const bars = sessionsWeeklyBars(sessions, 3, NOW);
    expect(bars.map(b => b.workouts)).toEqual([0, 1, 3]);
    expect(bars[2].isCurrent).toBe(true);
    expect(bars[1].weekStart).toBe('2026-09-21');
  });
});

describe('the streak survives a week with no gym session but a run (the Oct 1 fix)', () => {
  const workouts = [workout('w1', at(2026, 9, 29)), workout('w0', at(2026, 9, 15))]; // this week, and two weeks back
  it('workouts alone: the empty week between breaks it', () => {
    expect(sessionsStreakWeeks(mergeSessions(workouts, []), NOW)).toBe(1);
  });
  it('a run in that week bridges it', () => {
    expect(sessionsStreakWeeks(mergeSessions(workouts, [run('a1', at(2026, 9, 23))]), NOW)).toBe(3);
  });
  it('activities alone build a streak too; an empty current week does not break it', () => {
    expect(sessionsStreakWeeks(mergeSessions([], [run('a1', at(2026, 9, 23)), run('a2', at(2026, 9, 16))]), NOW)).toBe(2);
    expect(sessionsStreakWeeks([], NOW)).toBe(0);
  });
});

describe('training load (A11, Oct 16 2026)', () => {
  // Wednesday Oct 14 2026, local noon — inside the week of Monday Oct 12.
  const NOW_L = new Date(2026, 9, 14, 12, 0, 0);
  const at = (d: number) => new Date(2026, 9, d, 9, 0, 0).toISOString();
  const s = (id: string, day: number, minutes: number, effort?: number | null) => ({
    id,
    kind: 'activity' as const,
    startedAt: at(day),
    seconds: minutes * 60,
    volumeLbs: 0,
    title: id,
    ...(effort !== undefined ? { effort } : {}),
  });

  it('is minutes × effort; an unrated session adds nothing — never imputed', async () => {
    const { loadOf, sessionsWeeklySummary, sessionsWeeklyBars } = await import('../training/session-math');
    expect(loadOf({ seconds: 3600, effort: 7 })).toBe(420);
    expect(loadOf({ seconds: 3600, effort: null })).toBe(0);
    expect(loadOf({ seconds: 3600 })).toBe(0);
    expect(loadOf({ seconds: 3600, effort: 11 })).toBe(0);
    const week = sessionsWeeklySummary([s('a', 12, 60, 7), s('b', 13, 30, 4), s('c', 14, 45), s('d', 6, 50, 5)], NOW_L);
    expect(week).toMatchObject({ workouts: 3, load: 540, rated: 2, prior: { workouts: 1, load: 250, rated: 1 } });
    const bars = sessionsWeeklyBars([s('a', 12, 60, 7), s('c', 14, 45)], 2, NOW_L);
    expect(bars.at(-1)).toMatchObject({ workouts: 2, load: 420, rated: 1 });
  });

  it('a workout and an activity both carry their effort into the week', async () => {
    const { fromActivity } = await import('../training/sessions');
    const { workoutToSession } = await import('../workouts/dashboard');
    expect(fromActivity({ id: 'x', type: 'yoga', name: 'Flow', startedAt: at(12), elapsedS: 1800, movingS: null, distanceM: null, effort: 5 } as never).effort).toBe(5);
    expect(workoutToSession({ id: 'w', profile_id: 'p', title: 'Push', notes: null, status: 'completed', source: 'live', started_at: at(12), ended_at: at(12), duration_seconds: 2400, post_id: null, last_activity_at: at(12), updated_at: at(12), effort: 8 }).effort).toBe(8);
  });
});
