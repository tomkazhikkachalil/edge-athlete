import { describe, it, expect } from 'vitest';
import { startingHoleNumber } from '../holes';

const holes = (...nums: number[]) => nums.map(hole => ({ hole }));

describe('startingHoleNumber', () => {
  it('front rounds start at 1', () => {
    expect(startingHoleNumber(holes(1, 2, 3), 18)).toBe(1);
    expect(startingHoleNumber(holes(1, 2, 3, 4, 5, 6, 7, 8, 9), 9)).toBe(1);
  });

  it('a back-9 (holes 10–18) starts at 10', () => {
    expect(startingHoleNumber(holes(10, 11, 12, 13, 14, 15, 16, 17, 18), 9)).toBe(10);
  });

  it('no hole data → hole 1 (a back-9 without pars cannot signal its start)', () => {
    expect(startingHoleNumber(null, 9)).toBe(1);
    expect(startingHoleNumber(undefined, 18)).toBe(1);
    expect(startingHoleNumber([], 9)).toBe(1);
  });

  it('a range that would not fit on an 18-hole card falls back to 1', () => {
    // min 12 with 18 holes played would run to hole 29 — data is inconsistent.
    expect(startingHoleNumber(holes(12, 13, 14), 18)).toBe(1);
  });

  it('garbage hole numbers are ignored', () => {
    expect(startingHoleNumber([{ hole: NaN }, { hole: 0 }, { hole: 99 }], 9)).toBe(1);
    expect(startingHoleNumber([{ hole: NaN }, { hole: 10 }, { hole: 11 }], 9)).toBe(10);
  });

  it('missing holesPlayed derives the span from the data itself', () => {
    expect(startingHoleNumber(holes(10, 11, 12, 13, 14, 15, 16, 17, 18), null)).toBe(10);
  });
});
