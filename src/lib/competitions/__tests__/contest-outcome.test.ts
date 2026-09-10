import { describe, expect, it } from 'vitest';
import { deriveContestOutcome, type OutcomeParticipantInput } from '../contest-outcome';
import { assignSharedRanks, computeLeaderboardStandings, resolveLeaderboardRule } from '../scoring';

const p = (over: Partial<OutcomeParticipantInput> & { participantId: string }): OutcomeParticipantInput => ({
  entryId: `e-${over.participantId}`,
  side: null,
  startPosition: null,
  name: over.participantId,
  score: null,
  payload: null,
  ...over,
});

describe('deriveContestOutcome — fixture', () => {
  it('names the winner, the scoreline (home first) and completeness', () => {
    const o = deriveContestOutcome({
      format: 'fixture', sportKey: 'ice_hockey', scoringRule: null, status: 'completed',
      participants: [p({ participantId: 'away', side: 'away', score: 2 }), p({ participantId: 'home', side: 'home', score: 3 })],
    });
    expect(o.kind).toBe('fixture');
    if (o.kind !== 'fixture') return;
    expect(o.home?.name).toBe('home');
    expect(o.away?.name).toBe('away');
    expect(o.scoreline).toBe('3–2');
    expect(o.winnerEntryId).toBe('e-home');
    expect(o.tie).toBe(false);
    expect(o.complete).toBe(true);
  });

  it('a tie has no winner', () => {
    const o = deriveContestOutcome({
      format: 'fixture', sportKey: 'soccer', scoringRule: null, status: 'completed',
      participants: [p({ participantId: 'h', side: 'home', score: 1 }), p({ participantId: 'a', side: 'away', score: 1 })],
    });
    if (o.kind !== 'fixture') throw new Error('kind');
    expect(o.tie).toBe(true);
    expect(o.winnerEntryId).toBeNull();
    expect(o.scoreline).toBe('1–1');
  });

  it('is incomplete without both scores, even when the row says completed', () => {
    const o = deriveContestOutcome({
      format: 'fixture', sportKey: 'ice_hockey', scoringRule: null, status: 'completed',
      participants: [p({ participantId: 'h', side: 'home', score: 3 }), p({ participantId: 'a', side: 'away' })],
    });
    if (o.kind !== 'fixture') throw new Error('kind');
    expect(o.complete).toBe(false);
    expect(o.scoreline).toBeNull();
    expect(o.winnerEntryId).toBeNull();
  });

  it('falls back to start position when sides are unset, and TBD when a side is missing', () => {
    const o = deriveContestOutcome({
      format: 'fixture', sportKey: 'ice_hockey', scoringRule: null, status: 'scheduled',
      participants: [p({ participantId: 'second', startPosition: 2 }), p({ participantId: 'first', startPosition: 1 })],
    });
    if (o.kind !== 'fixture') throw new Error('kind');
    expect(o.home?.name).toBe('first');
    expect(o.away?.name).toBe('second');
    const solo = deriveContestOutcome({
      format: 'fixture', sportKey: 'ice_hockey', scoringRule: null, status: 'scheduled',
      participants: [p({ participantId: 'only', side: 'home' })],
    });
    if (solo.kind !== 'fixture') throw new Error('kind');
    expect(solo.away).toBeNull();
  });
});

describe('deriveContestOutcome — leaderboard', () => {
  it('ranks ascending with shared ranks, unscored last, and the leader first', () => {
    const o = deriveContestOutcome({
      format: 'leaderboard', sportKey: 'golf', scoringRule: 'stroke_total', status: 'completed',
      participants: [
        p({ participantId: 'c', score: 72 }),
        p({ participantId: 'a', score: 70 }),
        p({ participantId: 'z', score: null }),
        p({ participantId: 'b', score: 70 }),
      ],
    });
    if (o.kind !== 'leaderboard') throw new Error('kind');
    expect(o.direction).toBe('asc');
    expect(o.rows.map(r => [r.name, r.rank])).toEqual([['a', 1], ['b', 1], ['c', 3], ['z', null]]);
    expect(o.leaderEntryId).toBe('e-a');
    expect(o.complete).toBe(true);
    expect(o.columns[0].key).toBe('score');
  });

  it('ranks descending for a points rule', () => {
    const o = deriveContestOutcome({
      format: 'leaderboard', sportKey: 'golf', scoringRule: 'golf_points', status: 'in_progress',
      participants: [p({ participantId: 'low', score: 10 }), p({ participantId: 'high', score: 25 })],
    });
    if (o.kind !== 'leaderboard') throw new Error('kind');
    expect(o.direction).toBe('desc');
    expect(o.rows[0].name).toBe('high');
    expect(o.complete).toBe(false);
  });

  it('shows a rule column only when some row carries it (gross beside net)', () => {
    const withGross = deriveContestOutcome({
      format: 'leaderboard', sportKey: 'golf', scoringRule: 'golf_net', status: 'completed',
      participants: [p({ participantId: 'a', score: 68, payload: { gross: 80, net: 68 } })],
    });
    if (withGross.kind !== 'leaderboard') throw new Error('kind');
    expect(withGross.columns.map(c => c.key)).toEqual(['score', 'gross']);
    expect(withGross.rows[0].stats).toEqual({ gross: 80 });
    const without = deriveContestOutcome({
      format: 'leaderboard', sportKey: 'golf', scoringRule: 'golf_net', status: 'completed',
      participants: [p({ participantId: 'a', score: 68 })],
    });
    if (without.kind !== 'leaderboard') throw new Error('kind');
    expect(without.columns.map(c => c.key)).toEqual(['score']);
  });

  it('agrees with computeLeaderboardStandings on the rank rule', () => {
    const rule = resolveLeaderboardRule('golf', 'stroke_total');
    const standings = computeLeaderboardStandings(
      ['x', 'y', 'z'],
      [{ status: 'completed', scores: [{ entry_id: 'x', score: 70 }, { entry_id: 'y', score: 70 }, { entry_id: 'z', score: 75 }] }],
      rule
    );
    expect(standings.map(r => r.rank)).toEqual([1, 1, 3]);
  });
});

describe('deriveContestOutcome — other formats', () => {
  it('is unscored for a format the registry does not accept', () => {
    expect(deriveContestOutcome({ format: 'bracket', sportKey: 'tennis', scoringRule: null, status: 'scheduled', participants: [] }))
      .toEqual({ kind: 'unscored', complete: false });
  });
});

describe('assignSharedRanks', () => {
  it('shares the earlier rank and skips after a tie', () => {
    const keys = [1, 1, 2, 2, 2, 3];
    expect(assignSharedRanks(keys.length, i => keys[i])).toEqual([1, 1, 3, 3, 3, 6]);
    expect(assignSharedRanks(0, () => 0)).toEqual([]);
  });
});
