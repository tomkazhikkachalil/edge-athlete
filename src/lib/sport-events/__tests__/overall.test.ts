import { describe, expect, it } from 'vitest';
import type { LeaderboardRow } from '../leaderboard';
import { computeOverallLeaderboard, flightsOf, formatMovement, type RoundBoardInput } from '../overall';

/** A round row as computeLeaderboard emits it — gross/net/toPar over the scored holes. */
const row = (id: string, over: Partial<LeaderboardRow> = {}): LeaderboardRow => ({
  participantId: id,
  profileId: `pf-${id}`,
  name: id.toUpperCase(),
  handle: null,
  flight: null,
  rank: null,
  tied: false,
  rankLabel: '—',
  thru: 0,
  gross: null,
  toPar: null,
  net: null,
  netToPar: null,
  courseHandicap: null,
  netReason: null,
  cardStatus: 'in_progress',
  ...over,
});
const scored = (id: string, gross: number, toPar: number, thru = 18, extra: Partial<LeaderboardRow> = {}) => row(id, { thru, gross, toPar, ...extra });
const round = (sequence: number, status: RoundBoardInput['status'], rows: LeaderboardRow[], holes = 18): RoundBoardInput => ({ roundId: `r${sequence}`, sequence, status, holes, rows });

describe('computeOverallLeaderboard', () => {
  it('sums the rounds, ranks by total then to-par, shares ties as T2, lists the unscored last', () => {
    const board = computeOverallLeaderboard([
      round(1, 'completed', [scored('a', 72, 0), scored('b', 74, 2), scored('c', 74, 2), scored('d', 70, -2), row('e')]),
      round(2, 'completed', [scored('a', 70, -2), scored('b', 70, -2), scored('c', 70, -2), scored('d', 74, 2), row('e')]),
    ], 'stroke_gross');
    expect(board.current).toBe(2);
    expect(board.scoredRounds).toEqual([1, 2]);
    expect(board.rows.map(r => [r.name, r.rankLabel, r.total, r.totalToPar, r.roundsPlayed])).toEqual([
      ['A', '1', 142, -2, 2],
      ['B', 'T2', 144, 0, 2],
      ['C', 'T2', 144, 0, 2],
      ['D', 'T2', 144, 0, 2],
      ['E', '—', null, null, 0],
    ]);
    expect(board.rows[0].rounds.map(c => [c.sequence, c.gross, c.played])).toEqual([[1, 72, true], [2, 70, true]]);
    expect(board.rows[4].rounds.every(c => !c.played)).toBe(true);
  });

  it('a player who missed a completed round ranks below every full-field player, whatever the total', () => {
    const board = computeOverallLeaderboard([
      round(1, 'completed', [scored('a', 80, 8), scored('b', 70, -2)]),
      round(2, 'completed', [scored('a', 80, 8), row('b')]),
    ], 'stroke_gross');
    expect(board.rows.map(r => [r.name, r.rank, r.total, r.missedRounds])).toEqual([
      ['A', 1, 160, []],
      ['B', 2, 70, [2]],
    ]);
  });

  it('a live round counts as it stands: today / thru, the total moves, nobody has "missed" it yet', () => {
    const board = computeOverallLeaderboard([
      round(1, 'completed', [scored('a', 72, 0), scored('b', 72, 0)]),
      round(2, 'live', [scored('a', 9, 1, 2), row('b')]),
    ], 'stroke_gross');
    expect(board.current).toBe(2);
    const a = board.rows.find(r => r.name === 'A')!;
    const b = board.rows.find(r => r.name === 'B')!;
    expect(a.today).toEqual({ sequence: 2, toPar: 1, netToPar: null, thru: 2, holes: 18 });
    expect(a.total).toBe(81);
    expect(b.today).toEqual({ sequence: 2, toPar: null, netToPar: null, thru: 0, holes: 18 });
    expect(b.total).toBe(72);
    expect(b.missedRounds).toEqual([]);
    // B has not started today: the lower total still leads (yesterday's standing holds until someone passes it).
    expect(board.rows.map(r => r.name)).toEqual(['B', 'A']);
  });

  it('movement compares with the standing after the previous completed round; null before round 2', () => {
    const one = computeOverallLeaderboard([round(1, 'completed', [scored('a', 72, 0), scored('b', 74, 2)])], 'stroke_gross');
    expect(one.rows.map(r => [r.prevRank, r.movement])).toEqual([[null, null], [null, null]]);
    const two = computeOverallLeaderboard([
      round(1, 'completed', [scored('a', 72, 0), scored('b', 74, 2), scored('c', 76, 4)]),
      round(2, 'live', [scored('a', 40, 4, 9), scored('b', 34, -2, 9), scored('c', 38, 2, 9)]),
    ], 'stroke_gross');
    expect(two.rows.map(r => [r.name, r.rank, r.prevRank, r.movement])).toEqual([
      ['B', 1, 2, 1],
      ['A', 2, 1, -1],
      ['C', 3, 3, 0],
    ]);
    expect(formatMovement(1)).toEqual({ direction: 'up', label: 'Up 1' });
    expect(formatMovement(-2)).toEqual({ direction: 'down', label: 'Down 2' });
    expect(formatMovement(0)).toEqual({ direction: 'same', label: '—' });
    expect(formatMovement(null)).toEqual({ direction: null, label: '—' });
  });

  it('net: the key on a net event; net needs net in EVERY played round, else null with the reason', () => {
    const board = computeOverallLeaderboard([
      round(1, 'completed', [scored('a', 80, 8, 18, { net: 70, netToPar: -2 }), scored('b', 74, 2, 18, { net: 74, netToPar: 2 }), scored('c', 72, 0, 18, { netReason: 'no_index' })]),
      round(2, 'completed', [scored('a', 80, 8, 18, { net: 70, netToPar: -2 }), scored('b', 74, 2, 18, { net: 74, netToPar: 2 }), scored('c', 72, 0, 18, { netReason: 'no_index' })]),
    ], 'stroke_net');
    expect(board.rows.map(r => [r.name, r.rankLabel, r.net, r.netToPar, r.total, r.netReason])).toEqual([
      ['A', '1', 140, -4, 160, null],
      ['B', '2', 148, 4, 148, null],
      ['C', '—', null, null, 144, 'no_index'],
    ]);
  });

  it('a nine and an eighteen add up; scheduled and cancelled rounds are not on the board', () => {
    const board = computeOverallLeaderboard([
      round(1, 'completed', [scored('a', 36, 0, 9)], 9),
      round(2, 'completed', [scored('a', 72, 0, 18)]),
      round(3, 'scheduled', []),
      round(4, 'cancelled', []),
    ], 'stroke_gross');
    expect(board.rows[0].total).toBe(108);
    expect(board.rows[0].rounds.map(c => c.sequence)).toEqual([1, 2]);
    expect(board.current).toBe(2);
    expect(computeOverallLeaderboard([round(1, 'scheduled', [])], 'stroke_gross')).toMatchObject({ rows: [], current: null, scoredRounds: [], flights: [] });
  });

  it('a flight filter ranks within the flight; the flights list is the whole field\'s', () => {
    const rows = [scored('a', 70, -2, 18, { flight: 'A' }), scored('b', 80, 8, 18, { flight: 'B' }), scored('c', 75, 3, 18, { flight: 'B' }), scored('d', 71, -1, 18, { flight: 'A' })];
    const all = computeOverallLeaderboard([round(1, 'completed', rows)], 'stroke_gross');
    expect(all.flights).toEqual(['A', 'B']);
    expect(all.rows.map(r => [r.name, r.rank])).toEqual([['A', 1], ['D', 2], ['C', 3], ['B', 4]]);
    const b = computeOverallLeaderboard([round(1, 'completed', rows)], 'stroke_gross', { flight: 'B' });
    expect(b.flights).toEqual(['A', 'B']);
    expect(b.rows.map(r => [r.name, r.rank, r.flight])).toEqual([['C', 1, 'B'], ['B', 2, 'B']]);
    expect(flightsOf([{ flight: 'Flight 10' }, { flight: 'Flight 2' }, { flight: null }, { flight: 'Flight 2' }])).toEqual(['Flight 2', 'Flight 10']);
  });

  it('the order-only tiebreak: further along today lists first but shares the rank', () => {
    const board = computeOverallLeaderboard([
      round(1, 'live', [scored('a', 36, 0, 9), scored('b', 36, 0, 12)]),
    ], 'stroke_gross');
    expect(board.rows.map(r => [r.name, r.rankLabel, r.today?.thru])).toEqual([['B', 'T1', 12], ['A', 'T1', 9]]);
  });
});
