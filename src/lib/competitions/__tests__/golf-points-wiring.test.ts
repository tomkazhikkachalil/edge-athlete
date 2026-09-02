import { describe, expect, it } from 'vitest';
import { roundRuleFor } from '../golf-league';
import { LEADERBOARD_RULES, GOLF_LEADERBOARD_RULES, computeLeaderboardStandings } from '../scoring';
import { buildGolfLeaderBoards } from '../golf-leaders';
import { buildGolfBlock } from '../golf-weeks';

describe('roundRuleFor (C6)', () => {
  it('a points league ranks rounds on net by default, gross when configured; other rules pass through', () => {
    expect(roundRuleFor('golf_points', null)).toBe('golf_net');
    expect(roundRuleFor('golf_points', { golf: { pick: 'first', score: 'gross' } })).toBe('golf_gross');
    expect(roundRuleFor('golf_net', { golf: { score: 'gross' } })).toBe('golf_net');
    expect(roundRuleFor('golf_gross', null)).toBe('golf_gross');
    expect(roundRuleFor('anything', null)).toBe('stroke_total');
    expect(roundRuleFor(null, null)).toBe('stroke_total');
  });
});

describe('golf_points rule', () => {
  it('descends, draws RDS / PTS / W / GRS, and is offered to golf leaderboards', () => {
    const rule = LEADERBOARD_RULES.golf_points;
    expect(rule.direction).toBe('desc');
    expect(rule.columns.map(c => c.shortLabel)).toEqual(['RDS', 'PTS', 'W', 'GRS']);
    expect(GOLF_LEADERBOARD_RULES).toContain('golf_points');
  });
  it('sums the per-round points the recompute hands it; wins and gross ride as stats', () => {
    const rows = computeLeaderboardStandings(
      ['a', 'b'],
      [
        { status: 'completed', scores: [{ entry_id: 'a', score: 100, stats: { gross: 78, win: 1 } }, { entry_id: 'b', score: 75, stats: { gross: 82, win: 0 } }] },
        { status: 'completed', scores: [{ entry_id: 'a', score: 87.5, stats: { gross: 78, win: 1 } }, { entry_id: 'b', score: 87.5, stats: { gross: 78, win: 1 } }] },
      ],
      LEADERBOARD_RULES.golf_points
    );
    expect(rows.map(r => [r.entry_id, r.rank, r.points, r.stats.win, r.stats.gross])).toEqual([
      ['a', 1, 187.5, 2, 156],
      ['b', 2, 162.5, 1, 160],
    ]);
  });
});

describe('Most points leader board (C6)', () => {
  it('awards each round and sums per entrant, first on the list', () => {
    const boards = buildGolfLeaderBoards({
      rows: [
        { contestId: 'w1', contestRound: 'Week 1', contestPlayFrom: '2026-09-01', entryId: 'a', gross: 78, net: 70, holes: 18, score: 70 },
        { contestId: 'w1', contestRound: 'Week 1', contestPlayFrom: '2026-09-01', entryId: 'b', gross: 82, net: 74, holes: 18, score: 74 },
        { contestId: 'w2', contestRound: 'Week 2', contestPlayFrom: '2026-09-08', entryId: 'a', gross: 80, net: 72, holes: 18, score: 72 },
        { contestId: 'w2', contestRound: 'Week 2', contestPlayFrom: '2026-09-08', entryId: 'b', gross: 78, net: 72, holes: 18, score: 72 },
      ],
      nameByEntry: new Map([['a', 'Alex A.'], ['b', 'Bo B.']]),
      scoringRule: 'golf_net',
      pointsPreset: 'pga',
    });
    expect(boards[0].label).toBe('Most points');
    expect(boards[0].rows).toEqual([
      { name: 'Alex A.', value: 187.5 },
      { name: 'Bo B.', value: 162.5 },
    ]);
    expect(buildGolfLeaderBoards({ rows: [], nameByEntry: new Map(), scoringRule: 'golf_net', pointsPreset: 'pga' })).toEqual([]);
  });
});

describe('buildGolfBlock points (C6)', () => {
  it('a points league week carries per-result points by finishing position', () => {
    const block = buildGolfBlock({
      contests: [{ id: 'w1', round: 'Week 1', status: 'completed', venue_id: null, holes: 18, play_from: '2026-09-01', play_to: '2026-09-07' }],
      participants: [
        { id: 'p1', contest_id: 'w1', entry_id: 'a' },
        { id: 'p2', contest_id: 'w1', entry_id: 'b' },
      ],
      results: [
        { contest_id: 'w1', participant_id: 'p1', score: 70, payload: { gross: 78, net: 70, holes: 18 }, provenance: 'league_verified', dispute_status: null },
        { contest_id: 'w1', participant_id: 'p2', score: 74, payload: { gross: 82, net: 74, holes: 18 }, provenance: 'league_verified', dispute_status: null },
      ],
      entryName: new Map([['a', 'Alex A.'], ['b', 'Bo B.']]),
      omittedEntries: new Set(),
      courseNameByVenue: new Map(),
      pick: 'first',
      scoringRule: 'golf_net',
      pointsPreset: 'pga',
      today: '2026-09-10',
    });
    expect(block?.weeks[0].results.map(r => [r.entrant_name, r.net, r.points])).toEqual([
      ['Alex A.', 70, 100],
      ['Bo B.', 74, 75],
    ]);
    const plain = buildGolfBlock({
      contests: [{ id: 'w1', round: 'Week 1', status: 'completed', venue_id: null, holes: 18, play_from: '2026-09-01', play_to: '2026-09-07' }],
      participants: [{ id: 'p1', contest_id: 'w1', entry_id: 'a' }],
      results: [{ contest_id: 'w1', participant_id: 'p1', score: 70, payload: { gross: 78, net: 70, holes: 18 }, provenance: 'league_verified', dispute_status: null }],
      entryName: new Map([['a', 'Alex A.']]),
      omittedEntries: new Set(),
      courseNameByVenue: new Map(),
      pick: 'first',
      scoringRule: 'golf_net',
      today: '2026-09-10',
    });
    expect(plain?.weeks[0].results[0].points).toBeUndefined();
  });
});
