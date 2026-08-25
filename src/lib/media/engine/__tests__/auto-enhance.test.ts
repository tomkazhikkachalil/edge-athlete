import { describe, it, expect } from 'vitest';
import { autoEnhance, computeHistogram, percentile } from '../auto-enhance';

/** Histogram with `count` pixels at each of the given byte values. */
function hist(entries: Array<[value: number, count: number]>): Uint32Array {
  const h = new Uint32Array(256);
  for (const [value, count] of entries) h[value] += count;
  return h;
}

describe('percentile', () => {
  it('finds the bin at a cumulative fraction', () => {
    const h = hist([
      [10, 50],
      [200, 50],
    ]);
    expect(percentile(h, 0.25)).toBe(10);
    expect(percentile(h, 0.75)).toBe(200);
  });

  it('empty histogram returns 0', () => {
    expect(percentile(new Uint32Array(256), 0.5)).toBe(0);
  });
});

describe('autoEnhance', () => {
  it('an already-well-exposed image gets a near-neutral patch', () => {
    // lo ≈ 0.02·255≈5, hi ≈ 0.98·255≈250, median ≈ 0.45·255≈115.
    const h = hist([
      [5, 10],
      [115, 1000],
      [250, 10],
    ]);
    const patch = autoEnhance(h);
    expect(Math.abs(patch.light.exposure)).toBeLessThan(0.02);
    expect(Math.abs(patch.light.blacks)).toBeLessThan(0.1);
    expect(Math.abs(patch.light.whites)).toBeLessThan(0.15);
    expect(patch.contrast).toBeGreaterThanOrEqual(1);
    expect(patch.contrast).toBeLessThan(1.02);
  });

  it('a low-key image gets positive exposure, clamped to the EV cap', () => {
    // Everything under ~25% gray; median 0.1.
    const h = hist([
      [0, 100],
      [26, 1000],
      [64, 100],
    ]);
    const patch = autoEnhance(h);
    // log2(0.45/0.102…) ≈ 2.1 EV → clamped to +0.5 EV → slider +0.25.
    expect(patch.light.exposure).toBeCloseTo(0.25, 2);
    // No real highlights (hi < 0.65) → whites slider can't help → 0.
    expect(patch.light.whites).toBe(0);
  });

  it('a washed-out image (lifted blacks) pulls blacks down', () => {
    // lo ≈ 60/255 ≈ 0.235 — well above the 0.02 target.
    const h = hist([
      [60, 100],
      [140, 1000],
      [220, 100],
    ]);
    const patch = autoEnhance(h);
    expect(patch.light.blacks).toBeLessThan(-0.5);
  });

  it('a flat histogram earns the contrast bump; a full-range one does not', () => {
    const flat = autoEnhance(
      hist([
        [100, 100],
        [128, 1000],
        [150, 100],
      ])
    );
    expect(flat.contrast).toBeGreaterThan(1.05);
    const fullRange = autoEnhance(
      hist([
        [0, 100],
        [128, 1000],
        [255, 100],
      ])
    );
    expect(fullRange.contrast).toBeLessThan(1.01);
  });
});

describe('computeHistogram', () => {
  it('bins by Rec. 709 luma', () => {
    // One white pixel, one black, one pure green (luma ≈ 0.7152·255 ≈ 182).
    const data = new Uint8ClampedArray([
      255, 255, 255, 255,
      0, 0, 0, 255,
      0, 255, 0, 255,
    ]);
    const h = computeHistogram(data);
    expect(h[255]).toBe(1);
    expect(h[0]).toBe(1);
    expect(h[182]).toBe(1);
  });
});
