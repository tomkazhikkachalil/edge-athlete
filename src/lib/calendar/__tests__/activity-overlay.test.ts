import { describe, it, expect } from 'vitest';
import {
  workoutSessionToItem,
  golfRoundToItem,
  trainingPostToItem,
  statLinePostToItem,
  shouldSkipTrainingPost,
} from '../activity-overlay';

const USER = 'user-1';

describe('workoutSessionToItem', () => {
  const row = {
    id: 'w1',
    title: 'Push Day',
    started_at: '2026-08-10T14:00:00.000Z',
    ended_at: '2026-08-10T15:10:00.000Z',
    duration_seconds: 4200,
  };

  it('maps to a timed activity item', () => {
    const item = workoutSessionToItem(row, USER);
    expect(item.id).toBe('activity:workout:w1');
    expect(item.title).toBe('✓ Push Day');
    expect(item.kind).toBe('activity');
    expect(item.my_status).toBe('accepted');
    expect(item.series_id).toBeNull();
    expect(item.all_day).toBe(false);
    expect(item.category).toBe('workout');
    expect(item.starts_at).toBe('2026-08-10T14:00:00.000Z');
    expect(item.ends_at).toBe('2026-08-10T15:10:00.000Z');
    expect(item.activity).toEqual({
      source: 'workout', session_id: 'w1', duration_seconds: 4200, post_id: null,
    });
  });

  it('falls back to duration then a default when ended_at is null', () => {
    const noEnd = workoutSessionToItem({ ...row, ended_at: null }, USER);
    expect(noEnd.ends_at).toBe('2026-08-10T15:10:00.000Z'); // start + 4200s
    const bare = workoutSessionToItem({ ...row, ended_at: null, duration_seconds: null }, USER);
    expect(bare.ends_at).toBe('2026-08-10T15:00:00.000Z'); // start + 1h default
  });

  it('clamps a zero-duration session to a renderable window', () => {
    const zero = workoutSessionToItem(
      { ...row, ended_at: row.started_at, duration_seconds: 0 },
      USER
    );
    expect(Date.parse(zero.ends_at)).toBeGreaterThan(Date.parse(zero.starts_at));
  });

  it('titles untitled workouts', () => {
    expect(workoutSessionToItem({ ...row, title: null }, USER).title).toBe('✓ Workout');
  });
});

describe('golfRoundToItem', () => {
  it('is all-day with UTC-midnight exclusive-end bounds', () => {
    const item = golfRoundToItem(
      { id: 'g1', date: '2026-08-09', course: 'Pebble Beach', holes: 18, gross_score: 82 },
      USER
    );
    expect(item.id).toBe('activity:golf:g1');
    expect(item.title).toBe('✓ Pebble Beach');
    expect(item.all_day).toBe(true);
    expect(item.timezone).toBe('UTC');
    expect(item.starts_at).toBe('2026-08-09T00:00:00.000Z');
    expect(item.ends_at).toBe('2026-08-10T00:00:00.000Z');
    expect(item.category).toBe('game');
    expect(item.activity).toEqual({
      source: 'golf_round', round_id: 'g1', course: 'Pebble Beach', holes: 18, gross_score: 82,
      post_id: null,
    });
  });
});

describe('trainingPostToItem', () => {
  it('uses the caption (truncated) or a fallback title', () => {
    const item = trainingPostToItem(
      { id: 'p1', caption: 'Speed ladder work', created_at: '2026-08-08T18:00:00.000Z', stats_data: null },
      USER
    );
    expect(item.id).toBe('activity:post:p1');
    expect(item.title).toBe('✓ Speed ladder work');
    expect(item.category).toBe('training');
    expect(Date.parse(item.ends_at) - Date.parse(item.starts_at)).toBe(30 * 60_000);

    const untitled = trainingPostToItem(
      { id: 'p2', caption: '  ', created_at: '2026-08-08T18:00:00.000Z', stats_data: null },
      USER
    );
    expect(untitled.title).toBe('✓ Training session');
  });
});

describe('shouldSkipTrainingPost', () => {
  it('skips workout shares (session row covers them) and stat lines (deferred)', () => {
    expect(shouldSkipTrainingPost({ type: 'workout_session', workout_session_id: 'w1' })).toBe(true);
    expect(shouldSkipTrainingPost({ type: 'stat_line', sport_key: 'ice_hockey' })).toBe(true);
  });

  it('keeps plain training posts', () => {
    expect(shouldSkipTrainingPost(null)).toBe(false);
    expect(shouldSkipTrainingPost({})).toBe(false);
    expect(shouldSkipTrainingPost({ type: 'other' })).toBe(false);
  });
});

describe('post_id resolution on the payload', () => {
  it('carries a shared workout\'s post id', () => {
    const item = workoutSessionToItem(
      { id: 'w9', title: 'Shared', started_at: '2026-08-10T14:00:00.000Z', ended_at: null, duration_seconds: 600, post_id: 'p9' },
      USER
    );
    expect(item.activity).toMatchObject({ source: 'workout', post_id: 'p9' });
  });

  it('defaults an unshared workout to null', () => {
    const item = workoutSessionToItem(
      { id: 'w8', title: null, started_at: '2026-08-10T14:00:00.000Z', ended_at: null, duration_seconds: null },
      USER
    );
    expect(item.activity).toMatchObject({ post_id: null });
  });

  it('takes the golf post id from the caller (solo or mirrored group)', () => {
    const row = { id: 'g7', date: '2026-08-09', course: 'St Andrews', holes: 18, gross_score: 79 };
    expect(golfRoundToItem(row, USER, 'p7').activity).toMatchObject({ post_id: 'p7' });
    expect(golfRoundToItem(row, USER).activity).toMatchObject({ post_id: null });
  });

  it('a training post is its own post id', () => {
    const item = trainingPostToItem(
      { id: 'p3', caption: 'Drills', created_at: '2026-08-08T18:00:00.000Z', stats_data: null },
      USER
    );
    expect(item.activity).toEqual({ source: 'training_post', post_id: 'p3' });
  });
});

describe('statLinePostToItem', () => {
  const line = (over: Record<string, unknown> = {}) => ({
    id: 'p1',
    stats_data: {
      type: 'stat_line',
      sport_key: 'ice_hockey',
      date: '2026-08-15',
      opponent: 'Bears',
      result: 'W',
      stats: { goals: 2 },
      ...over,
    },
  });

  it('positions on the ATHLETE-ENTERED date as an all-day item', () => {
    const item = statLinePostToItem(line(), USER)!;
    expect(item.id).toBe('activity:statline:p1');
    expect(item.kind).toBe('activity');
    expect(item.all_day).toBe(true);
    expect(item.timezone).toBe('UTC');
    expect(item.category).toBe('game');
    expect(item.starts_at).toBe('2026-08-15T00:00:00.000Z');
    // UTC-midnight exclusive end (057 convention, same as golf)
    expect(item.ends_at).toBe('2026-08-16T00:00:00.000Z');
  });

  it('titles with opponent and result when present', () => {
    expect(statLinePostToItem(line(), USER)!.title).toBe('✓ vs Bears (W)');
    expect(statLinePostToItem(line({ result: undefined }), USER)!.title).toBe('✓ vs Bears');
    expect(statLinePostToItem(line({ opponent: undefined }), USER)!.title).toBe('✓ Ice Hockey');
  });

  it('payload routes to the post itself', () => {
    const item = statLinePostToItem(line(), USER)!;
    expect(item.activity).toEqual({
      source: 'stat_line',
      post_id: 'p1',
      sport_key: 'ice_hockey',
    });
  });

  it('returns null rather than rendering at epoch: missing or garbage date', () => {
    expect(statLinePostToItem(line({ date: undefined }), USER)).toBeNull();
    expect(statLinePostToItem(line({ date: 'yesterday' }), USER)).toBeNull();
    expect(statLinePostToItem(line({ date: '2026-8-15' }), USER)).toBeNull();
  });

  it('returns null for malformed stat lines', () => {
    expect(statLinePostToItem({ id: 'p1', stats_data: null }, USER)).toBeNull();
    expect(statLinePostToItem({ id: 'p1', stats_data: { type: 'workout_session' } }, USER)).toBeNull();
  });
});
