import { describe, it, expect } from 'vitest';
import {
  applyGrain,
  grainNoise,
  grainWeight,
  GRAIN_BASE_WEIGHT,
  GRAIN_MID_WEIGHT,
  GRAIN_SCALE,
  isNeutralGrain,
} from '../grain-math';

describe('grainNoise', () => {
  it('is deterministic and centered in −0.5..0.5', () => {
    expect(grainNoise(3, 7)).toBe(grainNoise(3, 7));
    let sum = 0;
    let min = 1;
    let max = -1;
    const n = 4096;
    for (let i = 0; i < n; i++) {
      const v = grainNoise(i % 64, Math.floor(i / 64));
      sum += v;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeGreaterThanOrEqual(-0.5);
    expect(max).toBeLessThanOrEqual(0.5);
    expect(Math.abs(sum / n)).toBeLessThan(0.02); // statistically zero-mean
    expect(max - min).toBeGreaterThan(0.8); // actually spans the range
  });

  it('neighboring cells decorrelate', () => {
    expect(grainNoise(10, 10)).not.toBeCloseTo(grainNoise(11, 10), 3);
  });
});

describe('grainWeight', () => {
  it('is midtone-heavy: base at the endpoints, full at 0.5', () => {
    expect(grainWeight(0)).toBeCloseTo(GRAIN_BASE_WEIGHT);
    expect(grainWeight(1)).toBeCloseTo(GRAIN_BASE_WEIGHT);
    expect(grainWeight(0.5)).toBeCloseTo(GRAIN_BASE_WEIGHT + GRAIN_MID_WEIGHT);
  });
});

describe('applyGrain', () => {
  const grain = { amount: 1, size: 1 };

  it('adds the same monochrome delta to all channels, bounded by the scale', () => {
    const [r, g, b] = applyGrain([0.5, 0.5, 0.5], 10, 10, grain);
    const delta = r - 0.5;
    expect(g - 0.5).toBeCloseTo(delta, 10);
    expect(b - 0.5).toBeCloseTo(delta, 10);
    expect(Math.abs(delta)).toBeLessThanOrEqual((GRAIN_SCALE / 2) * (GRAIN_BASE_WEIGHT + GRAIN_MID_WEIGHT));
  });

  it('cell size groups pixels: same cell → same delta, next cell may differ', () => {
    const big = { amount: 1, size: 3 };
    const a = applyGrain([0.5, 0.5, 0.5], 0, 0, big)[0];
    const b = applyGrain([0.5, 0.5, 0.5], 2, 2, big)[0]; // same 3px cell
    expect(a).toBe(b);
  });

  it('amount scales linearly', () => {
    const full = applyGrain([0.5, 0.5, 0.5], 5, 9, { amount: 1, size: 1 })[0] - 0.5;
    const half = applyGrain([0.5, 0.5, 0.5], 5, 9, { amount: 0.5, size: 1 })[0] - 0.5;
    expect(half).toBeCloseTo(full / 2, 10);
  });
});

describe('isNeutralGrain', () => {
  it('absent or zero amount is neutral; any amount is not', () => {
    expect(isNeutralGrain(undefined)).toBe(true);
    expect(isNeutralGrain({ amount: 0, size: 2 })).toBe(true);
    expect(isNeutralGrain({ amount: 0.2, size: 1 })).toBe(false);
  });
});
