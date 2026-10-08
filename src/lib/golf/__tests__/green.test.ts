import { describe, it, expect } from 'vitest';
import { greenDistances, nearestGreen, pointInRing, ringArea, ringCentroid, ringCrossings, type Ring } from '../green';
import { yardsBetween } from '../hole-geometry';

// A 30 m square green centred on (45, -75), built in the same sphere the
// distances use: 1° of latitude = 2π·6371 km / 360.
const M_PER_DEG = (2 * Math.PI * 6371000) / 360;
const LAT = 45;
const LNG = -75;
const half = 15;
const dLat = half / M_PER_DEG;
const dLng = half / (M_PER_DEG * Math.cos((LAT * Math.PI) / 180));
const square: Ring = [
  [LAT - dLat, LNG - dLng],
  [LAT - dLat, LNG + dLng],
  [LAT + dLat, LNG + dLng],
  [LAT + dLat, LNG - dLng],
];
const closed: Ring = [...square, square[0]];

const south = (yards: number): [number, number] => [LAT - (yards * 0.9144) / M_PER_DEG, LNG];
const HALF_YDS = half / 0.9144; // 16.4 yd

describe('ringCentroid', () => {
  it('is the middle of a square, open or closed', () => {
    const c = ringCentroid(square)!;
    expect(c[0]).toBeCloseTo(LAT, 6);
    expect(c[1]).toBeCloseTo(LNG, 6);
    expect(ringCentroid(closed)).toEqual(c);
  });
  it('needs three distinct vertices', () => {
    expect(ringCentroid([square[0], square[1]])).toBeNull();
    expect(ringCentroid([square[0], square[0], square[0], square[0]])).toBeNull();
  });
  it('falls back to the vertex mean for a zero-area ring', () => {
    const line: Ring = [[45, -75], [45.0001, -75], [45.0002, -75]];
    expect(ringCentroid(line)![0]).toBeCloseTo(45.0001, 6);
  });
});

describe('pointInRing', () => {
  it('answers the same for an open and a closed ring', () => {
    expect(pointInRing([LAT, LNG], square)).toBe(true);
    expect(pointInRing([LAT, LNG], closed)).toBe(true);
    expect(pointInRing(south(50), square)).toBe(false);
    expect(pointInRing(south(50), closed)).toBe(false);
  });
});

describe('ringCrossings', () => {
  it('finds the near and far edge along the ray', () => {
    const ts = ringCrossings(south(200), [LAT, LNG], square);
    expect(ts).toHaveLength(2);
    expect(ts[0]).toBeCloseTo(1 - HALF_YDS / 200, 3);
    expect(ts[1]).toBeCloseTo(1 + HALF_YDS / 200, 3);
  });
  it('is empty for a degenerate ring or a zero-length ray', () => {
    expect(ringCrossings(south(200), [LAT, LNG], [square[0], square[1]])).toEqual([]);
    expect(ringCrossings([LAT, LNG], [LAT, LNG], square)).toEqual([]);
  });
});

describe('greenDistances', () => {
  it('front / centre / back from 200 yards due south', () => {
    const d = greenDistances(south(200), square)!;
    expect(d.centre).toBe(200);
    expect(Math.abs(d.front! - (200 - HALF_YDS))).toBeLessThanOrEqual(1);
    expect(Math.abs(d.back! - (200 + HALF_YDS))).toBeLessThanOrEqual(1);
    expect(d.front!).toBeLessThan(d.centre);
    expect(d.back!).toBeGreaterThan(d.centre);
  });
  it('the centre agrees with yardsBetween to the centroid', () => {
    const fix = south(137);
    expect(greenDistances(fix, square)!.centre).toBe(yardsBetween(fix, ringCentroid(square)!));
  });
  it('is symmetric about the centre on a diagonal approach', () => {
    const fix: [number, number] = [LAT - 0.0015, LNG - 0.0021];
    const d = greenDistances(fix, square)!;
    expect(d.front).not.toBeNull();
    expect(d.back).not.toBeNull();
    expect(Math.abs(d.centre - d.front! - (d.back! - d.centre))).toBeLessThanOrEqual(1);
  });
  it('open and closed rings give the same trio', () => {
    expect(greenDistances(south(150), closed)).toEqual(greenDistances(south(150), square));
  });
  it('on the green there is no front or back', () => {
    const d = greenDistances([LAT + dLat / 2, LNG], square)!;
    expect(d.front).toBeNull();
    expect(d.back).toBeNull();
    expect(d.centre).toBeLessThan(10);
  });
  it('a two-vertex ring is null', () => {
    expect(greenDistances(south(200), [square[0], square[1]])).toBeNull();
  });
});

describe('nearestGreen (greens-only, PR 3)', () => {
  it('picks the ring whose centre is nearest and returns its trio', () => {
    const far: Ring = square.map(([a, b]) => [a + 0.01, b] as [number, number]);
    const n = nearestGreen(south(200), [far, square])!;
    expect(n.index).toBe(1);
    expect(n.distances.centre).toBe(200);
    expect(n.distances.front!).toBeLessThan(200);
  });
  it('null with no usable ring', () => {
    expect(nearestGreen(south(200), [])).toBeNull();
    expect(nearestGreen(south(200), [[square[0], square[1]]])).toBeNull();
  });
});

describe('ringArea (PR 5)', () => {
  it('a 30 m square is ~900 m²; a degenerate ring is 0', () => {
    expect(Math.abs(ringArea(square) - 900)).toBeLessThan(5);
    expect(ringArea(closed)).toBeCloseTo(ringArea(square), 6);
    expect(ringArea([square[0], square[1]])).toBe(0);
  });
});
