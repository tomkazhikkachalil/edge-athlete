import { describe, expect, it } from 'vitest';
import { FIXTURE_RULES } from '../scoring';
import { computePooledFixtureStandings, groupRowsByPool, isPoolLetter, poolIndex, poolLetter, poolsOf } from '../pools';

const rule = FIXTURE_RULES.points_2_1_0;
const game = (a: string, b: string, sa: number, sb: number, status = 'completed') => ({ status, sides: [{ entry_id: a, score: sa }, { entry_id: b, score: sb }] });

describe('pools — letters and groups', () => {
  it('letters A–H map to 1..8 and back; anything else is no pool', () => {
    expect(isPoolLetter('A')).toBe(true);
    expect(isPoolLetter('I')).toBe(false);
    expect(isPoolLetter(null)).toBe(false);
    expect(poolIndex('C')).toBe(3);
    expect(poolLetter(3)).toBe('C');
    expect(poolLetter(9)).toBeNull();
    expect(poolLetter(undefined)).toBeNull();
  });
  it('groups approved entries by letter in letter order, ignoring the unpooled and the unapproved', () => {
    expect(poolsOf([{ id: 'b1', pool: 'B', status: 'approved' }, { id: 'a1', pool: 'A', status: 'approved' }, { id: 'a2', pool: 'A', status: 'pending' }, { id: 'u', pool: null, status: 'approved' }, { id: 'x', pool: 'Z', status: 'approved' }])).toEqual([{ pool: 'A', entryIds: ['a1'] }, { pool: 'B', entryIds: ['b1'] }]);
  });
});

describe('computePooledFixtureStandings — rank within the pool, one row per entry, a cross-pool game counts nowhere', () => {
  const entries = [{ id: 'a1', pool: 'A' }, { id: 'a2', pool: 'A' }, { id: 'b1', pool: 'B' }, { id: 'b2', pool: 'B' }, { id: 'u', pool: null }];
  it('ranks each pool on its own and keeps the unpooled entry', () => {
    const rows = computePooledFixtureStandings(entries, [game('a1', 'a2', 3, 1), game('b2', 'b1', 2, 0), game('a1', 'b1', 5, 0)], rule);
    expect(rows.map(r => [r.entry_id, r.rank, r.points, r.stats.pool])).toEqual([['a1', 1, 2, 1], ['a2', 2, 0, 1], ['b2', 1, 2, 2], ['b1', 2, 0, 2], ['u', 1, 0, undefined]]);
    // the cross-pool game a1 vs b1 counted for nobody
    expect(rows.find(r => r.entry_id === 'a1')!.played).toBe(1);
    expect(rows.find(r => r.entry_id === 'b1')!.played).toBe(1);
  });
  it('without pools it is the flat table', () => {
    const flat = computePooledFixtureStandings([{ id: 'x', pool: null }, { id: 'y', pool: null }], [game('x', 'y', 1, 0)], rule);
    expect(flat.map(r => [r.entry_id, r.rank])).toEqual([['x', 1], ['y', 2]]);
    expect(flat[0].stats.pool).toBeUndefined();
  });
});

describe('groupRowsByPool — the renderers', () => {
  it('one uncaptioned group without pools; letter order then the unpooled with pools', () => {
    const rows: Array<{ stats: Record<string, number> }> = [{ stats: { pool: 2 } }, { stats: {} }, { stats: { pool: 1 } }];
    expect(groupRowsByPool(rows, false)).toEqual([{ pool: null, rows }]);
    expect(groupRowsByPool(rows, true).map(g => [g.pool, g.rows.length])).toEqual([['A', 1], ['B', 1], [null, 1]]);
  });
});

import { crossPoolSeeds, POOL_SEED_REFUSAL_COPY, poolGamePlan, poolSeedRefusal, roundRobinPairings } from '../pools';

describe('roundRobinPairings — the circle method', () => {
  it('four entries: three rounds of two games, every pair once, home and away balanced', () => {
    const games = roundRobinPairings(['a', 'b', 'c', 'd'], 1);
    expect(games).toHaveLength(6);
    expect(new Set(games.map(g => [g.home, g.away].sort().join(':'))).size).toBe(6);
    expect(Math.max(...games.map(g => g.round))).toBe(3);
    for (const id of ['a', 'b', 'c', 'd']) {
      const home = games.filter(g => g.home === id).length;
      expect(Math.abs(home - (3 - home))).toBeLessThanOrEqual(1);
    }
  });
  it('five entries sit one out per round; two legs mirror every game; fewer than two is nothing', () => {
    const five = roundRobinPairings(['a', 'b', 'c', 'd', 'e'], 1);
    expect(five).toHaveLength(10);
    expect(Math.max(...five.map(g => g.round))).toBe(5);
    const two = roundRobinPairings(['a', 'b', 'c', 'd'], 2);
    expect(two).toHaveLength(12);
    expect(two.filter(g => g.home === 'a' && g.away === 'b').length + two.filter(g => g.home === 'b' && g.away === 'a').length).toBe(2);
    expect(roundRobinPairings(['a'], 1)).toEqual([]);
  });
});

describe('poolGamePlan — per pool, minus what exists', () => {
  const pools = [{ pool: 'A' as const, entryIds: ['a1', 'a2', 'a3'] }, { pool: 'B' as const, entryIds: ['b1', 'b2'] }];
  it('one leg dedupes the unordered pair; two legs the ordered pair', () => {
    const one = poolGamePlan(pools, 1, new Set(['a2:a1']));
    expect(one.report).toEqual({ pools: [{ pool: 'A', entries: 3, games: 2, skipped: 1 }, { pool: 'B', entries: 2, games: 1, skipped: 0 }], games: 3, skipped: 1 });
    expect(one.games[0].label).toMatch(/^Pool A · Round \d$/);
    const two = poolGamePlan(pools, 2, new Set(['b1:b2']));
    expect(two.report.pools[1]).toEqual({ pool: 'B', entries: 2, games: 1, skipped: 1 });
  });
});

describe('crossPoolSeeds + poolSeedRefusal', () => {
  it('seeds cross the pools: A1, B1, A2, B2; a short pool contributes what it has', () => {
    expect(crossPoolSeeds([{ pool: 'A', entryIds: ['a1', 'a2', 'a3'] }, { pool: 'B', entryIds: ['b1'] }], 2)).toEqual(['a1', 'b1', 'a2']);
  });
  it('names every refusal, and every refusal has copy', () => {
    const src = { format: 'fixture', sport_key: 'ice_hockey', entrant_type: 'team' };
    const tgt = { format: 'bracket', sport_key: 'ice_hockey', entrant_type: 'team', status: 'active' };
    const ok = { pools: 2, drawn: false, seeds: 4 };
    expect(poolSeedRefusal(src, tgt, ok)).toBeNull();
    expect(poolSeedRefusal({ ...src, format: 'bracket' }, tgt, ok)).toBe('not_fixture');
    expect(poolSeedRefusal(src, tgt, { ...ok, pools: 0 })).toBe('no_pools');
    expect(poolSeedRefusal(src, { ...tgt, format: 'fixture' }, ok)).toBe('target_not_bracket');
    expect(poolSeedRefusal(src, { ...tgt, status: 'completed' }, ok)).toBe('target_closed');
    expect(poolSeedRefusal(src, tgt, { ...ok, drawn: true })).toBe('target_drawn');
    expect(poolSeedRefusal(src, { ...tgt, sport_key: 'soccer' }, ok)).toBe('sport_mismatch');
    expect(poolSeedRefusal(src, { ...tgt, entrant_type: 'athlete' }, ok)).toBe('entrant_mismatch');
    expect(poolSeedRefusal(src, tgt, { ...ok, seeds: 1 })).toBe('not_enough');
    expect(poolSeedRefusal(src, tgt, { ...ok, seeds: 65 })).toBe('too_many');
    for (const k of Object.keys(POOL_SEED_REFUSAL_COPY)) expect(POOL_SEED_REFUSAL_COPY[k as keyof typeof POOL_SEED_REFUSAL_COPY]).toBeTruthy();
  });
});
