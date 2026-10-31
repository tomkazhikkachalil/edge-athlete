import { describe, expect, it } from 'vitest';
import { MAP_TEE, sheetFromGeometry } from '../map-sheet';

const line: [number, number][] = [[45, -75], [45.001, -75]];
const measure = () => 399;
const holes = (n: number) => Array.from({ length: n }, (_, i) => ({ hole: i + 1, par: 4, line }));

describe('sheetFromGeometry: a card only when complete', () => {
  it('18 or 9 complete holes become a card with one measured yardage and unknown handicap', () => {
    const s = sheetFromGeometry(holes(18), measure)!;
    expect(s).toHaveLength(18);
    expect(s[0]).toEqual({ number: 1, par: 4, yardage: { [MAP_TEE]: 399 }, handicap: 0 });
    expect(sheetFromGeometry(holes(9), measure)).toHaveLength(9);
  });
  it('sorts by hole number', () => {
    expect(sheetFromGeometry([...holes(9)].reverse(), measure)![0].number).toBe(1);
  });
  it('anything short is no card: a missing or absurd par, a gap, a duplicate, a bad line, a wrong count', () => {
    const edit = (i: number, o: object) => holes(18).map((h, j) => (j === i ? { ...h, ...o } : h));
    expect(sheetFromGeometry(edit(4, { par: null }), measure)).toBeNull();
    expect(sheetFromGeometry(edit(4, { par: 9 }), measure)).toBeNull();
    expect(sheetFromGeometry(edit(4, { hole: 6 }), measure)).toBeNull();
    expect(sheetFromGeometry(edit(4, { hole: 19 }), measure)).toBeNull();
    expect(sheetFromGeometry(edit(4, { line: [[45, -75]] }), measure)).toBeNull();
    expect(sheetFromGeometry(holes(13), measure)).toBeNull();
    expect(sheetFromGeometry(null, measure)).toBeNull();
    expect(sheetFromGeometry(holes(18), () => 0)).toBeNull();
  });
});
