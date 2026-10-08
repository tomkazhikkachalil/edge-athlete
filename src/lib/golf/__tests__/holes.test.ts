import { describe, it, expect } from 'vitest';
import { deriveCourseHoles, roundHoleNumbers, startingHoleNumber, stepRoundHole } from '../holes';

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

describe('deriveCourseHoles (H2 — an unknown yardage stays unknown)', () => {
  const course: Array<{ number: number; par: number; yardage: Record<string, number>; handicap?: number }> = [
    { number: 1, par: 4, yardage: { white: 388, blue: 412 }, handicap: 11 },
    { number: 2, par: 3, yardage: { blue: 160 }, handicap: 0 },
    { number: 3, par: 5, yardage: {}, handicap: 3 },
    { number: 10, par: 4, yardage: { white: 400 } },
  ];
  it('the tee ladder: the chosen tee, then white / blue, then any; nothing invents 400', () => {
    const rows = deriveCourseHoles(course, 'white', 9, 1);
    expect(rows).toEqual([
      { hole: 1, par: 4, yardage: 388, handicap: 11 },
      { hole: 2, par: 3, yardage: 160 },
      { hole: 3, par: 5, handicap: 3 },
    ]);
    expect('yardage' in rows[2]).toBe(false);
    expect(deriveCourseHoles(course, 'blue', 18, 1)[0].yardage).toBe(412);
  });
  it('the hole range and an empty tee key', () => {
    expect(deriveCourseHoles(course, '', 9, 10)).toEqual([{ hole: 10, par: 4, yardage: 400 }]);
  });
});

describe('roundHoleNumbers + stepRoundHole (M1 — the chip walks the round)', () => {
  it('the round’s holes from its starting hole', () => {
    expect(roundHoleNumbers(1, 18)).toHaveLength(18);
    expect(roundHoleNumbers(10, 9)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(roundHoleNumbers(1, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(roundHoleNumbers(16, 9)).toEqual([16, 17, 18]); // never past 18
    expect(roundHoleNumbers(1, null)).toHaveLength(18);
    expect(roundHoleNumbers(0, 9)[0]).toBe(1);
  });
  it('steps cyclically both ways; an unknown current lands on the first', () => {
    const list = roundHoleNumbers(1, 9);
    expect(stepRoundHole(list, 9, 1)).toBe(1);
    expect(stepRoundHole(list, 1, -1)).toBe(9);
    expect(stepRoundHole(list, 4, 1)).toBe(5);
    expect(stepRoundHole(list, 14, 1)).toBe(1);
    expect(stepRoundHole(list, null, -1)).toBe(1);
    expect(stepRoundHole([], 1, 1)).toBeNull();
  });
});
