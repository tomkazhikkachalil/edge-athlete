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
