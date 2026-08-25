import { describe, it, expect } from 'vitest';
import { neutralizeWhiteBalance } from '../white-balance';
import { applyWhiteBalance } from '../color-math';

describe('neutralizeWhiteBalance', () => {
  it('an already-neutral sample needs no correction', () => {
    expect(neutralizeWhiteBalance(0.5, 0.5, 0.5)).toEqual({ temperature: 0, tint: 0 });
  });

  it('round-trips through the engine WB stage: the pick becomes neutral', () => {
    // A warm cast (r high, b low) with a green push.
    const cast: [number, number, number] = [0.55, 0.52, 0.45];
    const { temperature, tint } = neutralizeWhiteBalance(...cast);
    const [r, g, b] = applyWhiteBalance(cast, temperature, tint);
    expect(r).toBeCloseTo(b, 3); // temp equalizes r and b exactly
    expect(g).toBeCloseTo(r, 2); // tint pulls g onto them
  });

  it('a warm cast produces negative temperature (cool it down)', () => {
    const { temperature } = neutralizeWhiteBalance(0.6, 0.5, 0.4);
    expect(temperature).toBeLessThan(0);
  });

  it('a green cast produces positive tint (push magenta)', () => {
    const { tint } = neutralizeWhiteBalance(0.5, 0.6, 0.5);
    expect(tint).toBeGreaterThan(0);
  });

  it('extreme casts clamp to the slider range instead of exploding', () => {
    const wild = neutralizeWhiteBalance(1, 0.5, 0.01);
    expect(Math.abs(wild.temperature)).toBeLessThanOrEqual(1);
    expect(Math.abs(wild.tint)).toBeLessThanOrEqual(1);
  });

  it('degenerate samples (black / dead channel) return zeros', () => {
    expect(neutralizeWhiteBalance(0, 0, 0)).toEqual({ temperature: 0, tint: 0 });
    expect(neutralizeWhiteBalance(0.5, 0, 0.5)).toEqual({ temperature: 0, tint: 0 });
  });
});
