import { describe, expect, it } from 'vitest';
import { scorecardHoleNumbers } from '../round-display';

// Oct 31 2026: a round with no scores used to render no scorecard, on any course.
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
describe('scorecardHoleNumbers', () => {
  it('an unscored round shows the whole card, with or without a sheet', () => {
    expect(scorecardHoleNumbers([], 18, null, false)).toEqual(range(1, 18));
    expect(scorecardHoleNumbers([], 9, null, false)).toEqual(range(1, 9));
    expect(scorecardHoleNumbers([], null, null, false)).toEqual(range(1, 18));
    expect(scorecardHoleNumbers([], 9, range(10, 18).map(hole => ({ hole })), false)).toEqual(range(10, 18));
  });
  it('a live round with some scores still shows every hole', () => {
    expect(scorecardHoleNumbers([1, 2], 18, null, false)).toEqual(range(1, 18));
    expect(scorecardHoleNumbers([12, 13], 9, null, false)).toEqual(range(10, 18));
  });
  it('a finished round shows what was played; finished with no scores still shows a card', () => {
    expect(scorecardHoleNumbers(range(1, 13), 18, null, true)).toEqual(range(1, 13));
    expect(scorecardHoleNumbers([], 18, null, true)).toEqual(range(1, 18));
  });
});
