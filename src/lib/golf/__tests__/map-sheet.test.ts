import { describe, expect, it } from 'vitest';
import { MAP_TEE, PAR_CUTS_YARDS, countsAsPick, estimatePar, isMapSheet, sheetAgreesWithMap, sheetFromGeometry } from '../map-sheet';

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

// Nov 18 2026 (Tom): lines without pars get a card with the pars estimated from
// length, each one marked. Fitted on production's tagged holes that day.
describe('estimated pars: only when asked, only where the map has none, always marked', () => {
  it('the cut-offs: under 240 is a 3, under 460 a 4, under 720 a 5, then a 6', () => {
    expect(PAR_CUTS_YARDS).toEqual([240, 460, 720]);
    expect([90, 239, 240, 459, 460, 719, 720].map(estimatePar)).toEqual([3, 3, 4, 4, 5, 5, 6]);
  });
  it('without `estimate` a missing par is still no card (what the guards read)', () => {
    const bare = holes(18).map(h => ({ hole: h.hole, line: h.line }));
    expect(sheetFromGeometry(bare, measure)).toBeNull();
    expect(sheetFromGeometry(bare, measure, {})).toBeNull();
  });
  it('with `estimate`: a tagged par is kept unmarked, a missing or absurd one is estimated and marked', () => {
    const lengths = [150, 400, 520];
    const mixed = holes(9).map((h, i) => (i === 0 ? { ...h, par: 5 } : i === 1 ? { ...h, par: 9 } : { hole: h.hole, line: h.line }));
    let n = 0;
    const s = sheetFromGeometry(mixed, () => lengths[n++ % 3], { estimate: true })!;
    expect(s[0]).toEqual({ number: 1, par: 5, yardage: { [MAP_TEE]: 150 }, handicap: 0 }); // tagged 5 on a 150-yard line: the tag stands
    expect(s[1]).toEqual({ number: 2, par: 4, yardage: { [MAP_TEE]: 400 }, handicap: 0, parEstimated: true });
    expect(s[2]).toEqual({ number: 3, par: 5, yardage: { [MAP_TEE]: 520 }, handicap: 0, parEstimated: true });
    expect(s.filter(h => h.parEstimated)).toHaveLength(8);
  });
  it('an estimate still needs every line: a hole count, a gap or an unmeasured hole is no card', () => {
    const bare = (n: number) => holes(n).map(h => ({ hole: h.hole, line: h.line }));
    expect(sheetFromGeometry(bare(13), measure, { estimate: true })).toBeNull();
    expect(sheetFromGeometry(bare(18).map((h, i) => (i === 3 ? { hole: h.hole, line: null } : h)), measure, { estimate: true })).toBeNull();
    expect(sheetFromGeometry(bare(18).map((h, i) => (i === 3 ? { ...h, hole: 20 } : h)), measure, { estimate: true })).toBeNull();
    expect(sheetFromGeometry(bare(18), () => 0, { estimate: true })).toBeNull();
  });
  it('isMapSheet names both map sources and nothing else', () => {
    expect([isMapSheet('map'), isMapSheet('map_estimated'), isMapSheet('golfcourseapi'), isMapSheet(undefined)]).toEqual([true, true, false, false]);
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
