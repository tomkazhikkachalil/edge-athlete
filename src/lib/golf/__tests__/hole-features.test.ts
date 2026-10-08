import { describe, it, expect } from 'vitest';
import { deriveHoleGeometry, featurePoint, parseGolfFeatures, DERIVED_MIN_GREENS, DERIVED_MAX_LINE_YDS, GREEN_SAME_M, type GolfFeature } from '../hole-features';
import { polylineYards, resolveFeatureGeometry, resolveHoleGeometry, type OverpassElement } from '../hole-geometry';
import amberwood from './fixtures/overpass-amberwood.json';

// Map sweep PR 5: OSM's feature-tagged style (golf=tee|fairway|green + ref),
// no golf=hole way. Amberwood (a real capture, Oct 7 2026): nine numbered
// tees / fairways / greens, zero lines — and a mis-tagged practice green
// carrying ref=9 beside the real 9th.

const courseOf = (fx: unknown) => (fx as { _course: { name: string; lat: number; lng: number } })._course;
const elementsOf = (fx: unknown) => (fx as { elements: OverpassElement[] }).elements;
const M = (2 * Math.PI * 6371000) / 360;

describe('Amberwood — the real capture', () => {
  it('the strict parse has nothing; the feature tier gives nine lines and nine greens, flagged derived', () => {
    const c = courseOf(amberwood);
    expect(resolveHoleGeometry(amberwood, c.name, [c.lat, c.lng])).toBeNull();
    const g = resolveFeatureGeometry(amberwood, c.name, [c.lat, c.lng])!;
    expect(g).not.toBeNull();
    expect(g.derived).toBe('features');
    expect(g.holes.map(h => h.hole)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(g.greens!.map(x => x.hole)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const h of g.holes) {
      expect(h.line.length).toBeGreaterThanOrEqual(2);
      expect(h.line.length).toBeLessThanOrEqual(3);
      const yds = polylineYards(h.line)!;
      expect(yds).toBeGreaterThanOrEqual(60);
      expect(yds).toBeLessThanOrEqual(DERIVED_MAX_LINE_YDS);
    }
    // Every line ends on its green's centre (the same point the flag stands on).
    for (const h of g.holes) {
      const green = g.greens!.find(x => x.hole === h.hole)!;
      const end = h.line[h.line.length - 1];
      expect(green.ring.some(([lat, lng]) => Math.abs(lat - end[0]) < 0.001 && Math.abs(lng - end[1]) < 0.001)).toBe(true);
    }
  });
  it('the 9th: two rings carry ref=9, 232 m apart — the one twice the area is the green', () => {
    const feats = parseGolfFeatures(elementsOf(amberwood)).filter(f => f.ref === 9 && f.kind === 'green');
    expect(feats).toHaveLength(2);
    const g = deriveHoleGeometry(parseGolfFeatures(elementsOf(amberwood)))!;
    expect(g.greens!.find(x => x.hole === 9)).toBeTruthy();
  });
});

describe('deriveHoleGeometry — the rules on synthetic data', () => {
  const square = (lat: number, lng: number, half = 12): [number, number][] => {
    const d = half / M;
    return [[lat - d, lng - d], [lat - d, lng + d], [lat + d, lng + d], [lat + d, lng - d], [lat - d, lng - d]];
  };
  const green = (ref: number, lat: number, lng: number, half = 12, par: number | null = 4): GolfFeature => ({ kind: 'green', ref, point: [lat, lng], ring: square(lat, lng, half), par });
  const tee = (ref: number, lat: number, lng: number, par: number | null = 4): GolfFeature => ({ kind: 'tee', ref, point: [lat, lng], par });
  const fairway = (ref: number, lat: number, lng: number): GolfFeature => ({ kind: 'fairway', ref, point: [lat, lng], par: null });
  /** Nine due-north holes of 300 m, each with a back tee and a forward tee. */
  const nineHoles = (): GolfFeature[] => {
    const out: GolfFeature[] = [];
    for (let i = 1; i <= 9; i++) {
      const lng = -75.7 + i * 0.002;
      out.push(green(i, 45.3 + 300 / M, lng), tee(i, 45.3, lng), tee(i, 45.3 + 80 / M, lng));
    }
    return out;
  };
  it('the back tee (the farthest) starts the line; par from the agreeing features', () => {
    const g = deriveHoleGeometry(nineHoles())!;
    expect(g.holes).toHaveLength(9);
    expect(g.holes[0].line[0][0]).toBeCloseTo(45.3, 5);
    expect(g.holes[0].par).toBe(4);
    expect(polylineYards(g.holes[0].line)).toBe(328);
  });
  it('a fairway on the chord bends the line; one off the chord does not', () => {
    const on = [...nineHoles(), fairway(1, 45.3 + 150 / M, -75.7 + 0.002)];
    expect(deriveHoleGeometry(on)!.holes[0].line).toHaveLength(3);
    const off = [...nineHoles(), fairway(1, 45.3 + 150 / M, -75.7 + 0.002 + 400 / (M * Math.cos((45.3 * Math.PI) / 180)))];
    expect(deriveHoleGeometry(off)!.holes[0].line).toHaveLength(2);
  });
  it('a green with no tee keeps its green and has no line; a line outside 60–800 yd is dropped', () => {
    const noTee = nineHoles().filter(f => !(f.kind === 'tee' && f.ref === 3));
    const g = deriveHoleGeometry(noTee)!;
    expect(g.holes.map(h => h.hole)).toEqual([1, 2, 4, 5, 6, 7, 8, 9]);
    expect(g.greens!.map(x => x.hole)).toHaveLength(9);
    const tooLong = [...nineHoles().filter(f => !(f.kind === 'tee' && f.ref === 1)), tee(1, 45.3 - 500 / M, -75.7 + 0.002)];
    expect(deriveHoleGeometry(tooLong)!.holes.find(h => h.hole === 1)).toBeUndefined();
  });
  it('a tee past 800 m from its green is a neighbour’s', () => {
    const far = [...nineHoles().filter(f => !(f.kind === 'tee' && f.ref === 1)), tee(1, 45.3 - 900 / M, -75.7 + 0.002)];
    expect(deriveHoleGeometry(far)!.holes.find(h => h.hole === 1)).toBeUndefined();
  });
  it('two greens on one ref: close → the largest; far and comparable → the whole derivation is null; far and dominant → the big one', () => {
    const close = [...nineHoles(), green(2, 45.3 + 300 / M + 20 / M, -75.7 + 0.004, 20)];
    expect(deriveHoleGeometry(close)!.greens!.filter(x => x.hole === 2)).toHaveLength(1);
    expect(GREEN_SAME_M).toBe(60);
    const farEqual = [...nineHoles(), green(2, 45.3 + 600 / M, -75.7 + 0.004, 12)];
    expect(deriveHoleGeometry(farEqual)).toBeNull();
    const farSmall = [...nineHoles(), green(2, 45.3 + 600 / M, -75.7 + 0.004, 6)];
    const g = deriveHoleGeometry(farSmall)!;
    expect(g).not.toBeNull();
    expect(g.greens!.find(x => x.hole === 2)!.ring[0][0]).toBeCloseTo(45.3 + 300 / M - 12 / M, 5);
  });
  it('fewer than nine numbered greens → null; a par disagreement drops the par, not the hole', () => {
    expect(DERIVED_MIN_GREENS).toBe(9);
    expect(deriveHoleGeometry(nineHoles().filter(f => f.ref !== 9))).toBeNull();
    const conflict = nineHoles().map(f => (f.kind === 'tee' && f.ref === 1 ? { ...f, par: 5 } : f));
    expect(deriveHoleGeometry(conflict)!.holes[0].par).toBeNull();
  });
});

describe('parseGolfFeatures + featurePoint', () => {
  it('reads nodes, `out center` ways and ring ways; drops unnumbered features', () => {
    const els: OverpassElement[] = [
      { type: 'node', tags: { golf: 'tee', ref: '1' }, ...({ lat: 45.3, lon: -75.7 } as object) } as OverpassElement,
      { type: 'way', tags: { golf: 'fairway', ref: '1' }, ...({ center: { lat: 45.301, lon: -75.7 } } as object) } as OverpassElement,
      { type: 'way', tags: { golf: 'green', ref: '1', par: '4' }, geometry: [{ lat: 45.302, lon: -75.7 }, { lat: 45.3021, lon: -75.7 }, { lat: 45.3021, lon: -75.6999 }, { lat: 45.302, lon: -75.6999 }, { lat: 45.302, lon: -75.7 }] },
      { type: 'way', tags: { golf: 'green' }, geometry: [{ lat: 45.31, lon: -75.7 }, { lat: 45.3101, lon: -75.7 }, { lat: 45.3101, lon: -75.6999 }, { lat: 45.31, lon: -75.7 }] },
    ];
    const f = parseGolfFeatures(els);
    expect(f.map(x => `${x.kind}:${x.ref}`)).toEqual(['tee:1', 'fairway:1', 'green:1']);
    expect(f[0].point).toEqual([45.3, -75.7]);
    expect(f[1].point).toEqual([45.301, -75.7]);
    expect(f[2].ring).toHaveLength(5);
    expect(f[2].par).toBe(4);
    expect(featurePoint({ type: 'node', tags: {} })).toBeNull();
  });
});
