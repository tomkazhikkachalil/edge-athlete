import { describe, expect, it } from 'vitest';
import { scoreDifferential } from '@/lib/golf/handicap';
import { fromContestStatLine, fromGolfRound, fromStatLinePost, golfOverlayFromResult, groupUniformRows } from '../map';
import { HEADLINE_DIRECTION, PERFORMANCE_SOURCES, headlineDirection, naturalKey } from '../types';

// Data foundation F3 — the pure mappers from each origin row to the ONE
// performance shape. The invariants pinned here are the ones the writers
// (F4), the backfill (F5) and the scout search (F6) build on.

const POST = 'a0000000-0000-4000-8000-000000000001';
const ROUND = 'a0000000-0000-4000-8000-000000000002';
const LINE = 'a0000000-0000-4000-8000-000000000003';
const PROFILE = 'b0000000-0000-4000-8000-000000000001';
const CONTEST = 'c0000000-0000-4000-8000-000000000001';

describe('fromStatLinePost', () => {
  const post = (over: Record<string, unknown> = {}) => ({
    id: POST,
    profile_id: PROFILE,
    sport_key: 'ice_hockey',
    created_at: '2026-09-12T18:30:00Z',
    status: 'published',
    stats_data: { type: 'stat_line', sport_key: 'ice_hockey', date: '2026-09-10', opponent: 'Wolves', result: 'W', result_score: '4-2', stats: { goals: 2, assists: 1 } },
    ...over,
  });

  it('maps a valid line: the origin key, the line date, numeric metrics, the sport hero as headline, the context', () => {
    const row = fromStatLinePost(post());
    expect(row).toEqual({
      profile_id: PROFILE,
      sport_key: 'ice_hockey',
      occurred_on: '2026-09-10',
      source: 'post',
      source_table: 'posts',
      source_id: POST,
      natural_key: `post:${POST}`,
      metrics: { goals: 2, assists: 1 },
      context: { opponent: 'Wolves', result: 'W', result_score: '4-2' },
      headline: 3,
    });
    // The overlay keys are ABSENT — a self post carries the column default.
    expect(row && 'provenance' in row).toBe(false);
  });
  it('falls back to the post day without a line date; drops empty context', () => {
    const row = fromStatLinePost(post({ stats_data: { type: 'stat_line', sport_key: 'ice_hockey', stats: { goals: 1 } } }));
    expect(row?.occurred_on).toBe('2026-09-12');
    expect(row?.context).toBeNull();
  });
  it('answers null for a pending post, a non-stat-line blob, a line failing the schema, or no finite stat', () => {
    expect(fromStatLinePost(post({ status: 'pending_approval' }))).toBeNull();
    expect(fromStatLinePost(post({ stats_data: { score: 42 } }))).toBeNull();
    expect(fromStatLinePost(post({ stats_data: { type: 'stat_line', sport_key: 'ice_hockey', stats: { bogus: 1 } } }))).toBeNull();
    expect(fromStatLinePost(post({ sport_key: 'volleyball' }))).toBeNull(); // sport mismatch
    expect(fromStatLinePost(post({ stats_data: { type: 'stat_line', sport_key: 'ice_hockey', stats: {} } }))).toBeNull();
  });
  it('a legacy line dated in the future still maps (the backfill never rejects on today)', () => {
    expect(fromStatLinePost(post({ stats_data: { type: 'stat_line', sport_key: 'ice_hockey', date: '2999-01-01', stats: { goals: 1 } } }))?.occurred_on).toBe('2999-01-01');
  });
});

describe('fromGolfRound', () => {
  const round = (over: Record<string, unknown> = {}) => ({
    id: ROUND,
    profile_id: PROFILE,
    date: '2026-09-11',
    holes: 18,
    par: 72,
    gross_score: 84,
    total_putts: 33,
    fir_percentage: 50,
    gir_percentage: 38.89,
    course_rating: null,
    slope_rating: null,
    course_id: 'd0000000-0000-4000-8000-000000000001',
    course: 'Meadowvale GC',
    tee: 'White',
    group_post_id: null,
    ...over,
  });

  it('maps a solo round with the normalised metrics, gross as headline, NO differential without a rating and slope', () => {
    const row = fromGolfRound(round());
    expect(row).toMatchObject({
      sport_key: 'golf',
      occurred_on: '2026-09-11',
      source: 'post',
      source_table: 'golf_rounds',
      natural_key: `golf_round:${ROUND}`,
      metrics: { gross: 84, holes: 18, to_par: 12, putts: 33, fir_pct: 50, gir_pct: 38.89 },
      context: { course_id: 'd0000000-0000-4000-8000-000000000001', course: 'Meadowvale GC', tee: 'White' },
      headline: 84,
    });
    expect(row?.metrics.differential).toBeUndefined();
    expect(row && 'contest_id' in row).toBe(false);
  });
  it('stores the differential ONLY with a rating and a slope, by handicap.ts\'s exact formula', () => {
    const row = fromGolfRound(round({ course_rating: 71.2, slope_rating: 128 }));
    expect(row?.metrics.differential).toBe(scoreDifferential(84, 71.2, 128));
    expect(fromGolfRound(round({ course_rating: 71.2, slope_rating: 0 }))?.metrics.differential).toBeUndefined();
  });
  it('a live / shared round is source live_round; the overlay rides the same row when given', () => {
    expect(fromGolfRound(round({ group_post_id: 'e0000000-0000-4000-8000-000000000001' }))?.source).toBe('live_round');
    const overlay = { contest_id: CONTEST, provenance: 'league_verified' as const, dispute_status: 'none' as const, entered_by: PROFILE };
    const row = fromGolfRound(round(), overlay);
    expect(row).toMatchObject({ natural_key: `golf_round:${ROUND}`, ...overlay });
  });
  it('answers null without a positive gross (a round in progress)', () => {
    expect(fromGolfRound(round({ gross_score: null }))).toBeNull();
    expect(fromGolfRound(round({ gross_score: 0 }))).toBeNull();
  });
});

describe('fromContestStatLine', () => {
  const line = (over: Record<string, unknown> = {}) => ({
    id: LINE,
    contest_id: CONTEST,
    profile_id: PROFILE,
    stats: { kills: 12, digs: 4 },
    provenance: 'club_recorded' as const,
    entered_by: 'f0000000-0000-4000-8000-000000000001',
    created_at: '2026-09-09T10:00:00Z',
    ...over,
  });
  it('carries the org provenance verbatim, the contest, the contest day', () => {
    expect(fromContestStatLine(line(), 'volleyball', '2026-09-08T23:00:00Z')).toMatchObject({
      occurred_on: '2026-09-08',
      source: 'org_entry',
      source_table: 'contest_stat_lines',
      natural_key: `contest_stat_line:${LINE}`,
      contest_id: CONTEST,
      provenance: 'club_recorded',
      dispute_status: 'none',
      entered_by: 'f0000000-0000-4000-8000-000000000001',
      metrics: { kills: 12, digs: 4 },
      headline: 12,
    });
  });
  it('an imported line is source import; no contest day → the line\'s creation day; no schema / no stat → null', () => {
    expect(fromContestStatLine(line({ provenance: 'imported' }), 'volleyball', null)).toMatchObject({ source: 'import', occurred_on: '2026-09-09' });
    expect(fromContestStatLine(line(), 'golf', null)).toBeNull();
    expect(fromContestStatLine(line({ stats: { kills: 'many' } }), 'volleyball', null)).toBeNull();
  });
});

describe('golfOverlayFromResult', () => {
  it('reads the round from payload.roundRef; a result without one (a team sport) is null', () => {
    const r = golfOverlayFromResult({ contest_id: CONTEST, provenance: 'self_reported', dispute_status: 'disputed', entered_by: PROFILE, payload: { roundRef: { roundId: ROUND } } });
    expect(r).toEqual({ roundId: ROUND, overlay: { contest_id: CONTEST, provenance: 'self_reported', dispute_status: 'disputed', entered_by: PROFILE } });
    expect(golfOverlayFromResult({ contest_id: CONTEST, provenance: 'club_recorded', payload: { score: 3 } })).toBeNull();
    expect(golfOverlayFromResult({ contest_id: CONTEST, provenance: 'club_recorded', payload: { roundRef: { roundId: 'nope' } } })).toBeNull();
    expect(golfOverlayFromResult({ contest_id: CONTEST, provenance: 'club_recorded', dispute_status: 'weird', payload: { roundRef: { roundId: ROUND } } })?.overlay.dispute_status).toBe('none');
  });
});

describe('the shape helpers', () => {
  it('groupUniformRows separates rows by key set and keeps order inside a group', () => {
    const a = { natural_key: 'a', metrics: {} };
    const b = { natural_key: 'b', metrics: {}, contest_id: CONTEST };
    const c = { natural_key: 'c', metrics: {} };
    expect(groupUniformRows([a, b, c])).toEqual([[a, c], [b]]);
    expect(groupUniformRows([])).toEqual([]);
  });
  it('the natural keys name the ORIGIN ROW; the headline direction is lower for golf and track only', () => {
    expect(naturalKey.post('x')).toBe('post:x');
    expect(naturalKey.golfRound('x')).toBe('golf_round:x');
    expect(naturalKey.contestStatLine('x')).toBe('contest_stat_line:x');
    expect(Object.keys(HEADLINE_DIRECTION).sort()).toEqual(['golf', 'track_field']);
    expect(headlineDirection('golf')).toBe('lower');
    expect(headlineDirection('ice_hockey')).toBe('higher');
    expect([...PERFORMANCE_SOURCES]).toEqual(['post', 'live_round', 'org_entry', 'import']);
  });
});
