import { describe, expect, it } from 'vitest';
import { SLIDE_LOCK_AT, slideLocks, slideOffset, slideTrailWidth, slideTravel } from '../slide';

// Slide to go live (golf part 2, Nov 24 2026): the numbers behind the gesture.
describe('slideTravel — the track width minus 56', () => {
  it('a 270 px track lets the key travel 214 px; a tiny or unknown track has none', () => {
    expect(slideTravel(270)).toBe(214);
    expect(slideTravel(56)).toBe(0);
    expect(slideTravel(20)).toBe(0);
    expect(slideTravel(Number.NaN)).toBe(0);
  });
});

describe('slideOffset — the key never leaves its track', () => {
  it('follows the drag, clamped between 0 and the travel', () => {
    expect(slideOffset(100, 214)).toBe(100);
    expect(slideOffset(-40, 214)).toBe(0);
    expect(slideOffset(900, 214)).toBe(214);
    expect(slideOffset(50, 0)).toBe(0);
    expect(slideOffset(Number.NaN, 214)).toBe(0);
  });
});

describe('slideLocks — only a release at or past 85 % goes live', () => {
  it('locks at 85 % and beyond, not before', () => {
    expect(SLIDE_LOCK_AT).toBe(0.85);
    expect(slideLocks(214, 214)).toBe(true);
    expect(slideLocks(214 * 0.85, 214)).toBe(true);
    expect(slideLocks(214 * 0.84, 214)).toBe(false);
    expect(slideLocks(0, 214)).toBe(false);
  });
  it('a track with no travel never locks — a stray tap cannot start a round', () => {
    expect(slideLocks(0, 0)).toBe(false);
    expect(slideLocks(10, 0)).toBe(false);
  });
});

describe('slideTrailWidth — to just behind the key', () => {
  it('is the offset plus 30', () => {
    expect(slideTrailWidth(0)).toBe(30);
    expect(slideTrailWidth(120)).toBe(150);
    expect(slideTrailWidth(-5)).toBe(30);
  });
});
