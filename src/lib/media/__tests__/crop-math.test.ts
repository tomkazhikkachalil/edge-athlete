import { describe, it, expect } from 'vitest';
import { clampCrop, isFullFrameCrop, parseAspectRatio, rotatedSize, scaleRect, totalRotation } from '../crop-math';

describe('parseAspectRatio', () => {
  it('parses ratio ids to numbers', () => {
    expect(parseAspectRatio('1:1')).toBe(1);
    expect(parseAspectRatio('4:5')).toBeCloseTo(0.8);
    expect(parseAspectRatio('16:9')).toBeCloseTo(16 / 9);
    expect(parseAspectRatio('3:1')).toBe(3);
    expect(parseAspectRatio('free')).toBeNull();
  });
});

describe('rotatedSize', () => {
  it('is identity at 0 and 180, swaps at 90 and 270', () => {
    expect(rotatedSize(400, 300, 0)).toEqual({ width: 400, height: 300 });
    expect(rotatedSize(400, 300, 180).width).toBeCloseTo(400);
    expect(rotatedSize(400, 300, 90).width).toBeCloseTo(300);
    expect(rotatedSize(400, 300, 90).height).toBeCloseTo(400);
    expect(rotatedSize(400, 300, 270).width).toBeCloseTo(300);
  });

  it('matches the hand-computed bounding box at 30°', () => {
    // w' = 400·cos30 + 300·sin30 = 346.41 + 150 = 496.41
    // h' = 400·sin30 + 300·cos30 = 200 + 259.81 = 459.81
    const { width, height } = rotatedSize(400, 300, 30);
    expect(width).toBeCloseTo(496.41, 1);
    expect(height).toBeCloseTo(459.81, 1);
  });

  it('handles negative angles (straighten slider) symmetrically', () => {
    const pos = rotatedSize(400, 300, 15);
    const neg = rotatedSize(400, 300, -15);
    expect(neg.width).toBeCloseTo(pos.width);
    expect(neg.height).toBeCloseTo(pos.height);
  });
});

describe('clampCrop', () => {
  const bounds = { width: 1000, height: 800 };

  it('keeps an in-bounds crop unchanged', () => {
    const crop = { x: 100, y: 50, width: 400, height: 400 };
    expect(clampCrop(crop, bounds)).toEqual(crop);
  });

  it('pulls an overflowing crop back inside', () => {
    expect(clampCrop({ x: 700, y: 500, width: 400, height: 400 }, bounds)).toEqual({
      x: 600,
      y: 400,
      width: 400,
      height: 400,
    });
    expect(clampCrop({ x: -50, y: -20, width: 400, height: 400 }, bounds)).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 400,
    });
  });

  it('shrinks a crop larger than the bounds', () => {
    const clamped = clampCrop({ x: 0, y: 0, width: 2000, height: 900 }, bounds);
    expect(clamped.width).toBe(1000);
    expect(clamped.height).toBe(800);
  });
});

describe('totalRotation', () => {
  it('sums quarter turns and straighten', () => {
    expect(totalRotation(90, -12)).toBe(78);
    expect(totalRotation(0, 0)).toBe(0);
  });
});

describe('isFullFrameCrop (mount-noise guard)', () => {
  const natural = { width: 320, height: 240 };
  it('accepts the whole frame within rounding tolerance', () => {
    expect(isFullFrameCrop({ x: 0, y: 0, width: 320, height: 240 }, natural)).toBe(true);
    expect(isFullFrameCrop({ x: 1, y: 0, width: 319, height: 239 }, natural)).toBe(true);
  });
  it('rejects real crops', () => {
    expect(isFullFrameCrop({ x: 0, y: 0, width: 240, height: 240 }, natural)).toBe(false);
    expect(isFullFrameCrop({ x: 40, y: 0, width: 280, height: 240 }, natural)).toBe(false);
  });
});

describe('scaleRect (flip round)', () => {
  it('scales down and back up within a pixel', () => {
    const rect = { x: 100, y: 200, width: 1500, height: 900 };
    const down = scaleRect(rect, 0.5);
    expect(down).toEqual({ x: 50, y: 100, width: 750, height: 450 });
    expect(scaleRect(down, 2)).toEqual(rect);
  });

  it('never emits negative origins or empty sizes', () => {
    const tiny = scaleRect({ x: 0, y: 0, width: 1, height: 1 }, 0.1);
    expect(tiny.width).toBeGreaterThanOrEqual(1);
    expect(tiny.height).toBeGreaterThanOrEqual(1);
    expect(tiny.x).toBe(0);
  });
});
