import { describe, it, expect } from 'vitest';
import {
  isNeutralPerspective,
  NEUTRAL_PERSPECTIVE,
  perspectiveSourceCoord,
  PERSPECTIVE_SCALE,
  warpPerspective,
} from '../perspective-math';

describe('perspectiveSourceCoord', () => {
  it('zero correction is the identity everywhere', () => {
    for (const [x, y] of [
      [0, 0],
      [0.5, 0.5],
      [-0.3, 0.2],
    ] as const) {
      expect(perspectiveSourceCoord(x, y, NEUTRAL_PERSPECTIVE)).toEqual({ x, y });
    }
  });

  it('applies the keystone divisor w = 1 + scale·(v·y + h·x)', () => {
    const c = perspectiveSourceCoord(0.25, 0.25, { vertical: 1, horizontal: 0 })!;
    const w = 1 + PERSPECTIVE_SCALE * 0.25;
    expect(c.x).toBeCloseTo(0.25 * w);
    expect(c.y).toBeCloseTo(0.25 * w);
  });

  it('returns null once the sample leaves the source', () => {
    // Top edge with full vertical: y = 0.5·1.2 = 0.6 > 0.5.
    expect(perspectiveSourceCoord(0, 0.5, { vertical: 1, horizontal: 0 })).toBeNull();
    // Bottom edge shrinks inward instead — still inside.
    expect(perspectiveSourceCoord(0, -0.5, { vertical: 1, horizontal: 0 })).not.toBeNull();
  });

  it('w never approaches the projective singularity at slider extremes', () => {
    // Worst corner: |Δ| = scale·(0.5+0.5) = scale → w ∈ [1−scale, 1+scale].
    expect(1 - PERSPECTIVE_SCALE).toBeGreaterThan(0.5);
  });
});

describe('warpPerspective', () => {
  function white(w: number, h: number): Uint8ClampedArray {
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    return data;
  }

  it('neutral correction leaves bytes untouched', () => {
    const data = white(8, 8);
    const before = Array.from(data);
    warpPerspective(data, 8, 8, NEUTRAL_PERSPECTIVE);
    expect(Array.from(data)).toEqual(before);
  });

  it('vertical +1 blacks out the top edge, keeps bottom and center', () => {
    const w = 16;
    const h = 16;
    const data = white(w, h);
    warpPerspective(data, w, h, { vertical: 1, horizontal: 0 });
    expect(data[(0 * w + 8) * 4]).toBe(0); // top center → outside
    expect(data[(15 * w + 8) * 4]).toBe(255); // bottom center → inside
    expect(data[(8 * w + 8) * 4]).toBe(255); // center → inside
    for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(255); // alpha opaque
  });

  it('horizontal +1 blacks out the right edge instead', () => {
    const w = 16;
    const h = 16;
    const data = white(w, h);
    warpPerspective(data, w, h, { vertical: 0, horizontal: 1 });
    expect(data[(8 * w + 15) * 4]).toBe(0); // right center → outside
    expect(data[(8 * w + 0) * 4]).toBe(255); // left center → inside
  });
});

describe('isNeutralPerspective', () => {
  it('absent, null, and zeroed all count as neutral', () => {
    expect(isNeutralPerspective(undefined)).toBe(true);
    expect(isNeutralPerspective(null)).toBe(true);
    expect(isNeutralPerspective({ vertical: 0, horizontal: 0 })).toBe(true);
    expect(isNeutralPerspective({ vertical: 0.1, horizontal: 0 })).toBe(false);
  });
});
