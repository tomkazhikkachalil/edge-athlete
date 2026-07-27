import { describe, it, expect } from 'vitest';
import {
  MIN_CLIP_SECONDS,
  clampTrim,
  formatClipTime,
  fractionToTime,
  moveTrimHandle,
  splitRanges,
  thumbnailTimes,
  timeToFraction,
} from '../video-math';

describe('clampTrim', () => {
  it('keeps a valid range untouched', () => {
    expect(clampTrim({ start: 1, end: 5 }, 10)).toEqual({ start: 1, end: 5 });
  });

  it('clamps to the video bounds', () => {
    expect(clampTrim({ start: -2, end: 20 }, 10)).toEqual({ start: 0, end: 10 });
  });

  it('enforces the minimum clip length', () => {
    const r = clampTrim({ start: 5, end: 5.1 }, 10);
    expect(r.end - r.start).toBeGreaterThanOrEqual(MIN_CLIP_SECONDS - 1e-9);
  });
});

describe('moveTrimHandle', () => {
  const range = { start: 2, end: 8 };
  it('moves handles within bounds', () => {
    expect(moveTrimHandle(range, 'start', 4, 10).start).toBe(4);
    expect(moveTrimHandle(range, 'end', 6, 10).end).toBe(6);
  });
  it('start cannot cross end (min length preserved)', () => {
    const r = moveTrimHandle(range, 'start', 7.9, 10);
    expect(r.end - r.start).toBeGreaterThanOrEqual(MIN_CLIP_SECONDS - 1e-9);
    expect(r.end).toBe(8);
  });
  it('end cannot cross start', () => {
    const r = moveTrimHandle(range, 'end', 2.1, 10);
    expect(r.end - r.start).toBeGreaterThanOrEqual(MIN_CLIP_SECONDS - 1e-9);
  });
});

describe('thumbnailTimes', () => {
  it('samples midpoints of equal buckets', () => {
    expect(thumbnailTimes(10, 5)).toEqual([1, 3, 5, 7, 9]);
  });
  it('empty for degenerate inputs', () => {
    expect(thumbnailTimes(0, 5)).toEqual([]);
    expect(thumbnailTimes(10, 0)).toEqual([]);
  });
});

describe('splitRanges', () => {
  it('splits the full clip at a playhead', () => {
    expect(splitRanges(null, 4, 10)).toEqual([
      { start: 0, end: 4 },
      { start: 4, end: 10 },
    ]);
  });
  it('splits within an existing trim', () => {
    expect(splitRanges({ start: 2, end: 8 }, 5, 10)).toEqual([
      { start: 2, end: 5 },
      { start: 5, end: 8 },
    ]);
  });
  it('refuses splits that leave a sub-minimum half', () => {
    expect(splitRanges({ start: 2, end: 8 }, 2.2, 10)).toBeNull();
    expect(splitRanges({ start: 2, end: 8 }, 7.9, 10)).toBeNull();
  });
});

describe('fraction/time round-trip + formatting', () => {
  it('converts both ways with clamping', () => {
    expect(timeToFraction(5, 10)).toBe(0.5);
    expect(timeToFraction(15, 10)).toBe(1);
    expect(fractionToTime(0.25, 8)).toBe(2);
    expect(fractionToTime(-1, 8)).toBe(0);
  });
  it('formats clip times mm:ss.s', () => {
    expect(formatClipTime(0)).toBe('0:00.0');
    expect(formatClipTime(75.25)).toBe('1:15.3');
  });
});
