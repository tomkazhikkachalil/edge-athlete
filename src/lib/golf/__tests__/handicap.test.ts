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

// ── WHS-accuracy upgrade (9-hole conversion + series builder) ────────────────

import {
  nineHoleDifferential,
  isNineHoleEligible,
  buildHandicapSeries,
  scoreDifferential as sd,
  type EnrichedRound,
} from '../handicap';

const round18 = (gross: number, over: Partial<EnrichedRound> = {}): EnrichedRound => ({
  date: '2026-08-01',
  holes: 18,
  gross_score: gross,
  course_rating: 72.0,
  slope_rating: 113,
  par: 72,
  holeScores: null,
  allocations: null,
  ...over,
});

describe('nineHoleDifferential (Rule 5.1b)', () => {
  it('matches the published USGA/MGA/Golf Canada worked example', () => {
    // HI 14.0, 9-hole SD 7.2 → 7.2 + (0.52 × 14.0 + 1.2) = 15.68 → 15.7
    expect(nineHoleDifferential(7.2, 14.0)).toBe(15.7);
  });
});

describe('isNineHoleEligible', () => {
  it('accepts a plausible 9-hole round and rejects an 18-hole rating on it', () => {
    const base = { holes: 9, gross_score: 41, slope_rating: 120 };
    expect(isNineHoleEligible({ ...base, course_rating: 35.4 })).toBe(true);
    // The common bad entry: an 18-hole rating on a 9-hole round
    expect(isNineHoleEligible({ ...base, course_rating: 70.8 })).toBe(false);
    expect(isNineHoleEligible({ ...base, gross_score: 20, course_rating: 35.4 })).toBe(false);
  });
});

describe('buildHandicapSeries', () => {
  it('gross-only rounds reproduce the pre-upgrade indexes exactly', () => {
    // Old behavior: diffs from raw gross, index from the WHS table.
    const rounds = [round18(80), round18(85), round18(78)];
    const { diffs, current, series } = buildHandicapSeries(rounds);
    expect(diffs).toEqual([sd(80, 72, 113), sd(85, 72, 113), sd(78, 72, 113)]);
    // 3 diffs → lowest 1 − 2.0 = 6.0 − 2.0
    expect(current!.index).toBe(4);
    expect(series).toHaveLength(1);
  });

  it('skips 9-hole rounds until an index exists, then converts them', () => {
    const nine: EnrichedRound = {
      ...round18(41),
      holes: 9,
      gross_score: 41,
      course_rating: 35.4,
      slope_rating: 113,
      par: 36,
    };
    // 9-hole first: no prior index → skipped entirely
    const early = buildHandicapSeries([nine, round18(80), round18(85)]);
    expect(early.diffs).toHaveLength(2);
    expect(early.current).toBeNull(); // only 2 diffs

    // After three 18-hole rounds the same 9-holer converts via Rule 5.1b
    const later = buildHandicapSeries([round18(80), round18(85), round18(78), nine]);
    expect(later.diffs).toHaveLength(4);
    const priorIndex = 4; // from the first test
    const expected = nineHoleDifferential(sd(41, 35.4, 113), priorIndex);
    expect(later.diffs[3]).toBe(expected);
  });

  it('applies net double bogey when hole scores exist (blowup round tamed)', () => {
    // Establish an index of 4.0 first, then a disaster round with hole data:
    // every hole a 12 on par 4. Raw gross 216 → wild diff; NDB caps it.
    const blowup = round18(216, {
      holeScores: Array.from({ length: 18 }, () => ({ par: 4, strokes: 12 })),
      allocations: Array.from({ length: 18 }, (_, i) => i + 1),
    });
    const { diffs } = buildHandicapSeries([round18(80), round18(85), round18(78), blowup]);
    // priorIndex 4.0 → CH = round(4 × 113/113 + (72−72)) = 4 → four holes at
    // par+3, fourteen at par+2 → adjusted gross = 4×7 + 14×6 = 112
    expect(diffs[3]).toBe(sd(112, 72, 113));
  });

  it('keeps the mislabeled-round guards (gross 52 "18-hole" stays excluded)', () => {
    const bad = round18(52); // below MIN_PLAUSIBLE_18_HOLE_GROSS
    const { diffs } = buildHandicapSeries([round18(80), bad, round18(85)]);
    expect(diffs).toHaveLength(2);
  });
});
