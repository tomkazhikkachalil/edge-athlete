import { describe, it, expect } from 'vitest';
import { downscaleSteps, fitWithin, MAX_CANVAS_DIM } from '../limits';

describe('fitWithin', () => {
  it('never upscales', () => {
    expect(fitWithin(800, 600, 2048)).toEqual({ width: 800, height: 600, scale: 1 });
  });

  it('caps the longest edge preserving ratio', () => {
    const fit = fitWithin(8000, 6000, 2048);
    expect(fit.width).toBe(2048);
    expect(fit.height).toBe(1536);
    const portrait = fitWithin(3000, 4000, 2048);
    expect(portrait.height).toBe(2048);
    expect(portrait.width).toBe(1536);
  });

  it('never returns zero dimensions', () => {
    const fit = fitWithin(10000, 3, 512);
    expect(fit.height).toBeGreaterThanOrEqual(1);
  });
});

describe('downscaleSteps', () => {
  it('single step when within 2× of target', () => {
    expect(downscaleSteps(3000, 2000, 2048, 1365)).toEqual([{ width: 2048, height: 1365 }]);
  });

  it('halves until within 2×, then exact target', () => {
    const steps = downscaleSteps(8000, 8000, 1000, 1000);
    expect(steps).toEqual([
      { width: 4000, height: 4000 },
      { width: 2000, height: 2000 },
      { width: 1000, height: 1000 },
    ]);
  });

  it('MAX_CANVAS_DIM stays at the iOS-safe value', () => {
    expect(MAX_CANVAS_DIM).toBe(4096);
  });
});
