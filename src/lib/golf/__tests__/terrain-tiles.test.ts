import { describe, it, expect } from 'vitest';
import { decodeTerrarium, groupByTile, pixelIn, sampleBilinear, terrainTileUrl, tileFor, TERRAIN_ZOOM, TILE_SIZE } from '../terrain-tiles';

// T1 (Oct 2026): the pure half of the free elevation provider.

describe('tileFor + pixelIn', () => {
  it('Ottawa lands in the published z14 tile and a tile corner reads as pixel (0,0)', () => {
    const t = tileFor(45.4215, -75.6972);
    // x = (180 − 75.6972) / 360 · 2^14 = 4746.6; y from the Mercator formula = 5866.
    expect(t).toEqual({ z: TERRAIN_ZOOM, x: 4746, y: 5866 });
    // The NW corner of that tile, computed back from the tile index.
    const n = 2 ** TERRAIN_ZOOM;
    const lng = (t.x / n) * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * t.y) / n))) * 180) / Math.PI;
    const p = pixelIn(t, lat, lng);
    expect(p.px).toBeCloseTo(0, 6);
    expect(p.py).toBeCloseTo(0, 6);
    expect(tileFor(lat, lng)).toEqual(t);
  });
  it('a point inside the tile has a pixel inside [0, 256)', () => {
    const t = tileFor(45.4215, -75.6972);
    const p = pixelIn(t, 45.4215, -75.6972);
    expect(p.px).toBeGreaterThanOrEqual(0);
    expect(p.px).toBeLessThan(TILE_SIZE);
    expect(p.py).toBeGreaterThanOrEqual(0);
    expect(p.py).toBeLessThan(TILE_SIZE);
  });
  it('clamps the poles instead of producing NaN or an out-of-range tile', () => {
    expect(tileFor(90, 0).y).toBe(0);
    expect(tileFor(-90, 180).y).toBe(2 ** TERRAIN_ZOOM - 1);
    expect(Number.isFinite(pixelIn(tileFor(89.9, 0), 89.9, 0).py)).toBe(true);
  });
  it('builds the public S3 URL', () => {
    expect(terrainTileUrl({ z: 14, x: 4746, y: 5866 })).toBe('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/4746/5866.png');
  });
});

describe('decodeTerrarium + sampleBilinear', () => {
  it('sea level and the published encoding', () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(128, 100, 128)).toBeCloseTo(100.5, 6);
    expect(decodeTerrarium(127, 255, 0)).toBe(-1);
  });
  it('a 2×2 gradient blends, and the edges clamp', () => {
    // Pixel values: 0, 10 / 20, 30 metres (R=128, G=m).
    const data = Uint8Array.from([128, 0, 0, 128, 10, 0, 128, 20, 0, 128, 30, 0]);
    expect(sampleBilinear(data, 2, 2, 3, 0.5, 0.5)).toBe(0); // the first pixel's centre
    expect(sampleBilinear(data, 2, 2, 3, 1.5, 0.5)).toBe(10);
    expect(sampleBilinear(data, 2, 2, 3, 1, 1)).toBe(15); // the middle of the four
    expect(sampleBilinear(data, 2, 2, 3, 0, 0)).toBe(0); // clamped at the edge
    expect(sampleBilinear(data, 2, 2, 3, 2, 2)).toBe(30);
  });
  it('reads RGBA data too', () => {
    const data = Uint8Array.from([128, 5, 0, 255, 128, 5, 0, 255]);
    expect(sampleBilinear(data, 2, 1, 4, 1, 0.5)).toBe(5);
  });
});

describe('groupByTile', () => {
  it('keeps every index, grouped by tile, in order', () => {
    const coords: [number, number][] = [[45.4215, -75.6972], [45.4216, -75.6971], [45.0, -75.0]];
    const g = groupByTile(coords);
    expect(g.size).toBe(2);
    expect([...g.values()].flatMap(v => v.indexes).sort()).toEqual([0, 1, 2]);
    expect([...g.values()][0].indexes).toEqual([0, 1]);
  });
});
