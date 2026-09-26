import { describe, expect, it } from 'vitest';
import { orderStandingRows } from '../standings-order';

// Gaps round (Sep 26 2026): a stored tie reads back in ONE order — the
// bracket compute's (wins, then entry id) — whatever order the rows arrive.

const row = (entry_id: string, rank: number | null, w?: number) => ({ entry_id, rank, points: null, stats: w === undefined ? {} : { w } });

describe('orderStandingRows', () => {
  it("the bracket spec's tie: e5 (a win) before e3, from either input order", () => {
    const rows = [row('e2', 1, 2), row('e1', 2, 1), row('e5', 3, 1), row('e3', 3, 0), row('e4', 5, 0)];
    const want = ['e2', 'e1', 'e5', 'e3', 'e4'];
    expect(orderStandingRows(rows).map(r => r.entry_id)).toEqual(want);
    expect(orderStandingRows([...rows].reverse()).map(r => r.entry_id)).toEqual(want);
    expect(orderStandingRows([rows[3], rows[0], rows[4], rows[2], rows[1]]).map(r => r.entry_id)).toEqual(want);
  });

  it('a tie with equal wins (or no stats) falls through to the entry id', () => {
    expect(orderStandingRows([row('b', 1), row('a', 1), row('c', 1, 0)]).map(r => r.entry_id)).toEqual(['a', 'b', 'c']);
  });

  it('never touches ranks; an unranked row sorts last; the input is not mutated', () => {
    const input = [row('x', null), row('y', 2), row('z', 1)];
    const out = orderStandingRows(input);
    expect(out.map(r => [r.entry_id, r.rank])).toEqual([['z', 1], ['y', 2], ['x', null]]);
    expect(input.map(r => r.entry_id)).toEqual(['x', 'y', 'z']);
  });
});
