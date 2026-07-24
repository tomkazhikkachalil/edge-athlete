import { describe, it, expect } from 'vitest';
import {
  isHandicapEligible,
  scoreDifferential,
  handicapIndex,
  formatHandicapIndex,
} from '../handicap';

describe('scoreDifferential', () => {
  it('computes (113 / slope) × (gross − rating), 1 decimal', () => {
    // Real prod round: gross 71, rating 71.4, slope 133 → -0.3
    expect(scoreDifferential(71, 71.4, 133)).toBe(-0.3);
    // gross 83, rating 69.5, slope 125 → 12.2
    expect(scoreDifferential(83, 69.5, 125)).toBe(12.2);
    // gross 80, rating 69.5, slope 125 → 9.5
    expect(scoreDifferential(80, 69.5, 125)).toBe(9.5);
  });
});

describe('isHandicapEligible', () => {
  const base = { holes: 18, gross_score: 85, course_rating: 70, slope_rating: 125 };

  it('accepts a valid 18-hole round with rating + slope', () => {
    expect(isHandicapEligible(base)).toBe(true);
  });

  it('rejects 9-hole rounds', () => {
    expect(isHandicapEligible({ ...base, holes: 9 })).toBe(false);
  });

  it('rejects rounds missing rating or slope', () => {
    expect(isHandicapEligible({ ...base, course_rating: null })).toBe(false);
    expect(isHandicapEligible({ ...base, slope_rating: null })).toBe(false);
  });

  it('rejects an implausibly low 18-hole gross (regression: mislabeled 9-holers)', () => {
    // A 9-hole round stored as holes=18: gross 52 with rating 69.5 → -15.8
    // differential, which would have produced a +16.8 "handicap". Guarded by
    // the gross>=55 AND differential>=-10 floors.
    expect(isHandicapEligible({ ...base, gross_score: 52 })).toBe(false);
    expect(isHandicapEligible({ ...base, gross_score: 40 })).toBe(false);
    expect(isHandicapEligible({ ...base, gross_score: 36 })).toBe(false);
  });

  it('rejects an out-of-range slope', () => {
    expect(isHandicapEligible({ ...base, slope_rating: 200 })).toBe(false);
    expect(isHandicapEligible({ ...base, slope_rating: 0 })).toBe(false);
  });
});

describe('handicapIndex', () => {
  it('returns null with fewer than 3 differentials', () => {
    expect(handicapIndex([])).toBeNull();
    expect(handicapIndex([5.0, 6.0])).toBeNull();
  });

  it('matches the WHS small-sample table', () => {
    // 3 diffs → lowest 1, minus 2.0
    const three = handicapIndex([-0.3, 12.2, 9.5]);
    expect(three).not.toBeNull();
    expect(three!.index).toBe(-2.3); // min(-0.3) - 2.0
    expect(three!.diffsUsed).toBe(1);

    // 5 diffs → lowest 1, no adjustment
    const five = handicapIndex([10, 12, 8, 15, 9]);
    expect(five!.index).toBe(8);
    expect(five!.diffsUsed).toBe(1);

    // 6 diffs → lowest 2, minus 1.0
    const six = handicapIndex([10, 12, 8, 15, 9, 11]);
    expect(six!.index).toBe(7.5); // avg(8,9)=8.5, -1.0
    expect(six!.diffsUsed).toBe(2);
  });

  it('uses only the most recent 20 differentials', () => {
    // 25 diffs: first 5 are tiny (should be ignored — outside the window)
    const diffs = [-5, -5, -5, -5, -5, ...Array.from({ length: 20 }, () => 15)];
    const result = handicapIndex(diffs);
    expect(result!.roundsCounted).toBe(20);
    // lowest 8 of twenty 15s = 15
    expect(result!.index).toBe(15);
  });

  it('caps the index at 54.0', () => {
    const huge = handicapIndex(Array.from({ length: 20 }, () => 99));
    expect(huge!.index).toBe(54);
  });
});

describe('formatHandicapIndex', () => {
  it('formats normal and plus handicaps', () => {
    expect(formatHandicapIndex(4.2)).toBe('4.2');
    expect(formatHandicapIndex(0)).toBe('0.0');
    expect(formatHandicapIndex(-1.5)).toBe('+1.5'); // plus handicap
  });
});
