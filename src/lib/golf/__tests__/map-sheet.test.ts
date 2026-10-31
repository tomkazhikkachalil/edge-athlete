import { describe, expect, it } from 'vitest';
import { MAP_TEE, countsAsPick, sheetAgreesWithMap, sheetFromGeometry } from '../map-sheet';

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

describe('sheetAgreesWithMap: a provider card may replace a map card', () => {
  const card = (pars: number[]) => pars.map((par, i) => ({ number: i + 1, par }));
  const map = card([4, 5, 3, 5, 3, 4, 4, 3, 5]);
  it('accepts the same card, and up to two differing pars', () => {
    expect(sheetAgreesWithMap(map, map)).toBe(true);
    expect(sheetAgreesWithMap(card([5, 4, 3, 5, 3, 4, 4, 3, 5]), map)).toBe(true);
  });
  it('refuses three differing pars, another hole count, or other hole numbers', () => {
    expect(sheetAgreesWithMap(card([5, 4, 4, 5, 3, 4, 4, 3, 5]), map)).toBe(false);
    expect(sheetAgreesWithMap(card([4, 5, 3]), map)).toBe(false);
    expect(sheetAgreesWithMap(map.map(h => ({ ...h, number: h.number + 9 })), map)).toBe(false);
  });
  it('with no map card there is nothing to protect', () => {
    expect(sheetAgreesWithMap(map, null)).toBe(true);
  });
});

describe('countsAsPick', () => {
  it('QA accounts do not count; everyone else does', () => {
    expect(countsAsPick('EdgeQA-abc@edgeathlete.ca')).toBe(false);
    expect(countsAsPick('tom@example.com')).toBe(true);
    expect(countsAsPick(null)).toBe(true);
  });
});
