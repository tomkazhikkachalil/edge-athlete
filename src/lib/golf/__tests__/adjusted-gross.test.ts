import { describe, it, expect } from 'vitest';
import {
  courseHandicap,
  strokesForHole,
  rankStrokeIndexes,
  adjustedGross,
} from '../adjusted-gross';

describe('courseHandicap (Rule 6.1a)', () => {
  it('HI × slope/113 + (CR − par), rounded', () => {
    // 14.0 × 133/113 + (71.4 − 72) = 16.48 − 0.6 = 15.88 → 16
    expect(courseHandicap(14.0, 133, 71.4, 72)).toBe(16);
    // scratch on a standard course
    expect(courseHandicap(0, 113, 72, 72)).toBe(0);
    // plus player: −2.0 × 120/113 + (70 − 72) = −4.12 → −4
    expect(courseHandicap(-2.0, 120, 70, 72)).toBe(-4);
  });
});

describe('strokesForHole', () => {
  it('gives floor(CH/18) everywhere plus one on the lowest CH%18 indexes', () => {
    // CH 16: one stroke on SI 1..16, none on 17/18
    expect(strokesForHole(16, 1)).toBe(1);
    expect(strokesForHole(16, 16)).toBe(1);
    expect(strokesForHole(16, 17)).toBe(0);
    // CH 20: one stroke everywhere, a second on SI 1..2
    expect(strokesForHole(20, 1)).toBe(2);
    expect(strokesForHole(20, 3)).toBe(1);
  });

  it('plus players give strokes back from SI 18 downward', () => {
    // CH −2: give back on SI 18 and 17
    expect(strokesForHole(-2, 18)).toBe(-1);
    expect(strokesForHole(-2, 17)).toBe(-1);
    expect(strokesForHole(-2, 16)).toBe(0);
  });
});

describe('rankStrokeIndexes', () => {
  it('re-ranks a played subset to 1..N relative order', () => {
    // A back-9's raw indexes re-rank so allocation math works on 1..9
    expect(rankStrokeIndexes([4, 16, 2, 8])).toEqual([2, 4, 1, 3]);
  });

  it('unknown (0/null) entries stay null without poisoning the rest', () => {
    expect(rankStrokeIndexes([4, 0, 2, null])).toEqual([2, null, 1, null]);
  });
});

describe('adjustedGross (Rule 3.1b)', () => {
  const holes = (n: number, par: number, strokes: number) =>
    Array.from({ length: n }, () => ({ par, strokes }));

  it('no index → every hole caps at par + 5', () => {
    // par 4, strokes 12 → capped at 9 each
    expect(adjustedGross(holes(18, 4, 12), null, null)).toBe(9 * 18);
    // scores under the cap pass through untouched
    expect(adjustedGross(holes(18, 4, 5), null, null)).toBe(90);
  });

  it('exact net double bogey with known allocation', () => {
    // CH 1, SI [1, 2]: hole 1 caps at par+3, hole 2 at par+2
    const ag = adjustedGross(
      [{ par: 4, strokes: 10 }, { par: 4, strokes: 10 }],
      [1, 2],
      1
    );
    expect(ag).toBe(7 + 6);
  });

  it('unknown allocation degrades HIGH (par + 2 + ceil(CH/18), never flattering)', () => {
    // CH 16 → cap par + 3 on every hole
    const degraded = adjustedGross(holes(18, 4, 12), null, 16);
    expect(degraded).toBe(7 * 18);
    // Any REAL allocation gives a cap ≤ the degrade cap on every hole
    const allocations = Array.from({ length: 18 }, (_, i) => i + 1);
    const exact = adjustedGross(holes(18, 4, 12), allocations, 16);
    expect(exact).toBeLessThanOrEqual(degraded);
  });

  it('plus-player degrade never goes below net double bogey', () => {
    // CH −4, unknown allocation → cap stays par + 2
    expect(adjustedGross(holes(9, 4, 10), null, -4)).toBe(6 * 9);
  });

  it('passthrough: scores under every cap are untouched', () => {
    expect(adjustedGross(holes(18, 4, 4), null, 10)).toBe(72);
  });
});
