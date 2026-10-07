import { describe, it, expect } from 'vitest';
import { formatRise, metresToYards, parseStoredElevation, playsLikeYards, riseToGreen, sampleHoleLine, SAMPLES_PER_HOLE } from '../elevation';
import { elevationFresh, ELEVATION_TTL_MS } from '../elevation-server';
import { haversineKm } from '../geocode';

// PR C (Oct 2026): the pure half of "plays like".

const line: [number, number][] = [[45.3, -75.7], [45.3015, -75.6996], [45.303, -75.699]];

describe('sampleHoleLine', () => {
  it('keeps the tee and the green and spaces the samples by distance', () => {
    const pts = sampleHoleLine(line);
    expect(pts).toHaveLength(SAMPLES_PER_HOLE);
    expect(pts[0]).toEqual(line[0]);
    expect(pts[pts.length - 1]).toEqual(line[line.length - 1]);
    const gaps = pts.slice(1).map((p, i) => haversineKm({ lat: pts[i][0], lng: pts[i][1] }, { lat: p[0], lng: p[1] }));
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    for (const g of gaps) expect(Math.abs(g - mean) / mean).toBeLessThan(0.05);
  });
  it('a degenerate line samples nothing; a zero-length line is its two ends', () => {
    expect(sampleHoleLine([[45, -75]])).toEqual([]);
    expect(sampleHoleLine([])).toEqual([]);
    expect(sampleHoleLine([[45, -75], [45, -75]])).toEqual([[45, -75], [45, -75]]);
  });
});

describe('playsLikeYards — the apps\' rule of thumb', () => {
  it('uphill adds a yard per yard of rise; downhill takes two thirds; flat is unchanged', () => {
    expect(playsLikeYards(388, 7)).toBe(395);
    expect(playsLikeYards(388, -9)).toBe(382);
    expect(playsLikeYards(388, 0)).toBe(388);
    expect(playsLikeYards(150.4, 0)).toBe(150);
  });
  it('a missing rise is a flat shot', () => {
    expect(playsLikeYards(200, Number.NaN)).toBe(200);
  });
});

describe('riseToGreen', () => {
  const pts = sampleHoleLine(line, 4);
  const profile = { pts, elev: [100, 102, 105, 106.4] };
  it('reads the nearest sample: from the tee the whole rise, from the green none', () => {
    expect(riseToGreen(profile, line[0])).toBeCloseTo(6.4, 5);
    expect(riseToGreen(profile, line[2])).toBeCloseTo(0, 5);
    expect(riseToGreen(profile, pts[1])).toBeCloseTo(4.4, 5);
  });
  it('downhill is negative; metres convert to yards', () => {
    expect(riseToGreen({ pts, elev: [110, 108, 104, 100] }, line[0])).toBeCloseTo(-10, 5);
    expect(metresToYards(6.4)).toBeCloseTo(7.0, 1);
  });
  it('an empty or mismatched profile is null', () => {
    expect(riseToGreen(null, line[0])).toBeNull();
    expect(riseToGreen({ pts, elev: [1, 2] }, line[0])).toBeNull();
  });
});

describe('formatRise + parseStoredElevation', () => {
  it('says the yards up or down, nothing under a yard', () => {
    expect(formatRise(7.2)).toBe('↑ 7 yd');
    expect(formatRise(-4.6)).toBe('↓ 5 yd');
    expect(formatRise(0.4)).toBeNull();
    expect(formatRise(null)).toBeNull();
  });
  it('accepts the stored shape, drops a hole whose points and elevations disagree, refuses the rest', () => {
    const good = { holes: [{ hole: 2, pts: [[45, -75], [45.001, -75]], elev: [10, 12] }, { hole: 1, pts: [[45, -75], [45.001, -75]], elev: [10] }], sampled: 'line10', source: 'open-meteo' };
    const parsed = parseStoredElevation(good);
    expect(parsed?.holes.map(h => h.hole)).toEqual([2]);
    expect(parseStoredElevation({ holes: [], source: 'open-meteo' })).toBeNull();
    expect(parseStoredElevation({ holes: [{ hole: 1, pts: [[45, -75], [45.001, -75]], elev: [1, 2] }], source: 'osm' })).toBeNull();
    expect(parseStoredElevation(null)).toBeNull();
  });
});

describe('elevationFresh — 30 days, and never older than the geometry', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  it('fresh within the TTL; stale past it; stale when the geometry is newer; never without a stamp', () => {
    expect(elevationFresh({ hole_elevation_at: new Date(now - 1000).toISOString(), hole_geometry_at: new Date(now - 2000).toISOString() }, now)).toBe(true);
    expect(elevationFresh({ hole_elevation_at: new Date(now - ELEVATION_TTL_MS - 1).toISOString(), hole_geometry_at: null }, now)).toBe(false);
    expect(elevationFresh({ hole_elevation_at: new Date(now - 1000).toISOString(), hole_geometry_at: new Date(now - 500).toISOString() }, now)).toBe(false);
    expect(elevationFresh({ hole_elevation_at: null, hole_geometry_at: null }, now)).toBe(false);
  });
});
