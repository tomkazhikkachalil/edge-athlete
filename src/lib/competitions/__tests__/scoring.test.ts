import { describe, expect, it } from 'vitest';
import {
  computeFixtureStandings,
  FIXTURE_RULES,
  resolveFixtureRule,
} from '../scoring';

const RULE = FIXTURE_RULES.points_2_1_0;

const game = (a: string, sa: number | null, b: string, sb: number | null, status = 'completed') => ({
  status,
  sides: [
    { entry_id: a, score: sa },
    { entry_id: b, score: sb },
  ],
});

describe('resolveFixtureRule', () => {
  it('sport defaults: hockey 2-1-0, soccer 3-1-0; unknown sport falls back; unknown rule key falls back', () => {
    expect(resolveFixtureRule('ice_hockey', null).key).toBe('points_2_1_0');
    expect(resolveFixtureRule('soccer', null).key).toBe('points_3_1_0');
    expect(resolveFixtureRule('curling', null).key).toBe('points_2_1_0');
    expect(resolveFixtureRule('ice_hockey', 'hand_edited_garbage').key).toBe('points_2_1_0');
    expect(resolveFixtureRule('ice_hockey', 'points_3_1_0').key).toBe('points_3_1_0');
  });
});

describe('computeFixtureStandings', () => {
  it('a tiny season: points, W/L/T, GF/GA/diff, ordering', () => {
    // A beats B 3-2; A ties C 1-1; B beats C 4-0.
    const rows = computeFixtureStandings(
      ['A', 'B', 'C'],
      [game('A', 3, 'B', 2), game('A', 1, 'C', 1), game('B', 4, 'C', 0)],
      RULE
    );
    const byId = Object.fromEntries(rows.map(r => [r.entry_id, r]));
    expect(byId.A).toMatchObject({ rank: 1, points: 3, played: 2 });
    expect(byId.A.stats).toEqual({ w: 1, l: 0, t: 1, gf: 4, ga: 3, diff: 1 });
    expect(byId.B).toMatchObject({ rank: 2, points: 2, played: 2 });
    expect(byId.B.stats).toEqual({ w: 1, l: 1, t: 0, gf: 6, ga: 3, diff: 3 });
    expect(byId.C).toMatchObject({ rank: 3, points: 1, played: 2 });
  });

  it('ignores incomplete games, partial scores, and departed entries', () => {
    const rows = computeFixtureStandings(
      ['A', 'B'],
      [
        game('A', 3, 'B', 2, 'scheduled'),
        game('A', 3, 'B', null),
        game('A', 5, 'GONE', 0),
      ],
      RULE
    );
    const byId = Object.fromEntries(rows.map(r => [r.entry_id, r]));
    expect(byId.A.played).toBe(0);
    expect(byId.B.played).toBe(0);
  });

  it('tiebreak chain: points → wins → diff → gf; full ties SHARE the rank', () => {
    // A and B both 2 points; A on a win (2-1-0: one W one L), B on two ties.
    const chain = computeFixtureStandings(
      ['A', 'B', 'X', 'Y'],
      [
        game('A', 2, 'X', 0),
        game('A', 0, 'Y', 3),
        game('B', 1, 'X', 1),
        game('B', 2, 'Y', 2),
      ],
      RULE
    );
    const byId = Object.fromEntries(chain.map(r => [r.entry_id, r]));
    expect(byId.A.points).toBe(2);
    expect(byId.B.points).toBe(2);
    expect(byId.A.rank).toBeLessThan(byId.B.rank); // the win breaks it

    // Two entries with NO games are FULLY tied → shared rank (the loser
    // of a game is NOT tied with them — its diff differs).
    const tied = computeFixtureStandings(['P', 'S', 'Q', 'R'], [game('P', 1, 'S', 0)], RULE);
    const t = Object.fromEntries(tied.map(r => [r.entry_id, r]));
    expect(t.P.rank).toBe(1);
    expect([t.Q.rank, t.R.rank]).toEqual([2, 2]); // gameless twins share
    expect(t.S.rank).toBe(4); // the loser sorts below on diff
  });

  it('is order-independent (pure)', () => {
    const games = [game('A', 3, 'B', 2), game('B', 1, 'C', 1), game('C', 0, 'A', 2)];
    const forward = computeFixtureStandings(['A', 'B', 'C'], games, RULE);
    const backward = computeFixtureStandings(['C', 'B', 'A'], [...games].reverse(), RULE);
    expect(Object.fromEntries(forward.map(r => [r.entry_id, r.rank]))).toEqual(
      Object.fromEntries(backward.map(r => [r.entry_id, r.rank]))
    );
  });

  it('3-1-0 changes the arithmetic', () => {
    const rows = computeFixtureStandings(
      ['A', 'B'],
      [game('A', 1, 'B', 0)],
      FIXTURE_RULES.points_3_1_0
    );
    expect(rows.find(r => r.entry_id === 'A')!.points).toBe(3);
  });
});
