import { describe, it, expect } from 'vitest';
import {
  appendStrokePoint,
  extendRaster,
  MAX_POINTS_PER_STROKE,
  rasterizeBrushMask,
  sampleMaskBuffer,
  stampStroke,
} from '../mask-raster';
import type { BrushStroke } from '../../types';

const stroke = (
  points: Array<{ x: number; y: number }>,
  overrides: Partial<BrushStroke> = {}
): BrushStroke => ({ points, radius: 0.1, feather: 0.5, ...overrides });

describe('appendStrokePoint (pointer decimation)', () => {
  it('drops points closer than a quarter radius, keeps real movement', () => {
    let points = [{ x: 0.5, y: 0.5 }];
    points = appendStrokePoint(points, 0.505, 0.5, 0.1); // 0.005 < 0.025
    expect(points).toHaveLength(1);
    points = appendStrokePoint(points, 0.54, 0.5, 0.1); // 0.04 ≥ 0.025
    expect(points).toHaveLength(2);
  });

  it('stops at the stroke capacity', () => {
    let points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < MAX_POINTS_PER_STROKE + 20; i++) {
      points = appendStrokePoint(points, (i * 0.9) / MAX_POINTS_PER_STROKE, 0.5, 0.001);
    }
    expect(points.length).toBeLessThanOrEqual(MAX_POINTS_PER_STROKE);
  });
});

describe('rasterizeBrushMask', () => {
  const W = 64;
  const H = 64;
  const at = (buf: Float32Array, u: number, v: number) => sampleMaskBuffer(buf, W, H, u, v);

  it('a single dab covers its core and nothing far away', () => {
    const buf = rasterizeBrushMask([stroke([{ x: 0.5, y: 0.5 }])], W, H);
    expect(at(buf, 0.5, 0.5)).toBeCloseTo(1, 1);
    expect(at(buf, 0.9, 0.9)).toBe(0);
  });

  it('a horizontal stroke paints its whole corridor', () => {
    const buf = rasterizeBrushMask(
      [stroke([{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }])],
      W,
      H
    );
    for (const u of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      expect(at(buf, u, 0.5)).toBeGreaterThan(0.9);
    }
    expect(at(buf, 0.5, 0.1)).toBe(0); // far off the corridor
  });

  it('feather 0 is hard-edged; feather 1 ramps from the center', () => {
    const hard = rasterizeBrushMask([stroke([{ x: 0.5, y: 0.5 }], { feather: 0 })], W, H);
    expect(at(hard, 0.5 + 0.08, 0.5)).toBeCloseTo(1, 1); // inside r=0.1
    const soft = rasterizeBrushMask([stroke([{ x: 0.5, y: 0.5 }], { feather: 1 })], W, H);
    expect(at(soft, 0.5 + 0.08, 0.5)).toBeLessThan(0.5); // well down the ramp
    expect(at(soft, 0.5, 0.5)).toBeGreaterThan(0.9);
  });

  it('overlapping paint composes with max (never over-brightens)…', () => {
    const one = stroke([{ x: 0.5, y: 0.5 }], { feather: 0 });
    const buf = rasterizeBrushMask([one, one, one], W, H);
    expect(at(buf, 0.5, 0.5)).toBeLessThanOrEqual(1);
  });

  it('…and erase strokes carve painted areas back out', () => {
    const paint = stroke([{ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 }], { feather: 0 });
    const erase = stroke([{ x: 0.5, y: 0.5 }], { feather: 0, erase: true });
    const buf = rasterizeBrushMask([paint, erase], W, H);
    expect(at(buf, 0.5, 0.5)).toBeLessThan(0.05); // erased center
    expect(at(buf, 0.3, 0.5)).toBeGreaterThan(0.9); // untouched ends
  });

  it('discs are circular in image space even on non-square buffers', () => {
    // 128×32 buffer (4:1 aspect): a dab with r=0.1 of WIDTH must reach the
    // same physical distance vertically as horizontally.
    const buf = rasterizeBrushMask([stroke([{ x: 0.5, y: 0.5 }], { feather: 0 })], 128, 32);
    const right = sampleMaskBuffer(buf, 128, 32, 0.5 + 0.08, 0.5);
    // 0.08 of width vertically = 0.08·(128/32) = 0.32 in v units.
    const below = sampleMaskBuffer(buf, 128, 32, 0.5, 0.5 + 0.32 * 0.9);
    expect(right).toBeGreaterThan(0.9);
    expect(below).toBeGreaterThan(0.5);
    expect(sampleMaskBuffer(buf, 128, 32, 0.5, 0.95)).toBe(0);
  });
});

describe('extendRaster (incremental painting)', () => {
  const W = 48;
  const H = 48;

  it('growing the last stroke incrementally equals a full recompute', () => {
    const prev = [stroke([{ x: 0.2, y: 0.5 }, { x: 0.4, y: 0.5 }])];
    const next = [stroke([{ x: 0.2, y: 0.5 }, { x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }])];
    const incremental = rasterizeBrushMask(prev, W, H);
    expect(extendRaster(incremental, prev, next, W, H)).toBe(true);
    const full = rasterizeBrushMask(next, W, H);
    let maxDiff = 0;
    for (let i = 0; i < full.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(full[i] - incremental[i]));
    }
    expect(maxDiff).toBeLessThan(1e-6);
  });

  it('appending a NEW stroke is also incremental', () => {
    const prev = [stroke([{ x: 0.2, y: 0.3 }])];
    const next = [prev[0], stroke([{ x: 0.7, y: 0.7 }])];
    const incremental = rasterizeBrushMask(prev, W, H);
    expect(extendRaster(incremental, prev, next, W, H)).toBe(true);
    const full = rasterizeBrushMask(next, W, H);
    for (let i = 0; i < full.length; i++) {
      expect(Math.abs(full[i] - incremental[i])).toBeLessThan(1e-6);
    }
  });

  it('refuses non-extensions: removals, edits, and grown non-last strokes', () => {
    const a = stroke([{ x: 0.2, y: 0.5 }]);
    const b = stroke([{ x: 0.6, y: 0.5 }]);
    const buf = new Float32Array(W * H);
    expect(extendRaster(buf, [a, b], [a], W, H)).toBe(false); // removal
    expect(
      extendRaster(buf, [a], [stroke([{ x: 0.21, y: 0.5 }])], W, H) // edited point
    ).toBe(false);
    const aGrown = stroke([{ x: 0.2, y: 0.5 }, { x: 0.3, y: 0.5 }]);
    expect(extendRaster(buf, [a, b], [aGrown, b], W, H)).toBe(false); // non-last grew
    expect(
      extendRaster(buf, [a], [stroke([{ x: 0.2, y: 0.5 }], { radius: 0.2 })], W, H) // prop change
    ).toBe(false);
  });

  it('stampStroke(fromPointIndex) stamps only the new tail', () => {
    const base = rasterizeBrushMask([stroke([{ x: 0.2, y: 0.5 }, { x: 0.4, y: 0.5 }])], W, H);
    const grown = stroke([{ x: 0.2, y: 0.5 }, { x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }]);
    stampStroke(base, W, H, grown, 2);
    const full = rasterizeBrushMask([grown], W, H);
    for (let i = 0; i < full.length; i++) {
      expect(Math.abs(full[i] - base[i])).toBeLessThan(1e-6);
    }
  });
});
