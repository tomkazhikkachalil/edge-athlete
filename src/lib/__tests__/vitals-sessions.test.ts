import { describe, expect, it } from 'vitest';
import {
  fromActivity,
  mergeSessions,
  sessionsActiveDays,
  sessionsStreakWeeks,
  sessionsWeeklyBars,
  sessionsWeeklySummary,
  type ActivitySession,
} from '../vitals/sessions';
import type { ServerWorkoutSession } from '../workouts/serialize';

// Oct 1 2026: a run from a watch counts in Vitals. Until then the week, the
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
