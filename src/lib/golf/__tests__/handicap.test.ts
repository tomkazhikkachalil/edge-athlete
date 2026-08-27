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
  provisionalIndex,
  exceptionalReduction,
  applyCaps,
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
  it('gross-only rounds reproduce the established WHS indexes exactly', () => {
    const rounds = [round18(80), round18(85), round18(78)];
    const { diffs, current, series } = buildHandicapSeries(rounds);
    expect(diffs).toEqual([sd(80, 72, 113), sd(85, 72, 113), sd(78, 72, 113)]);
    // 3 diffs → lowest 1 − 2.0 = 6.0 − 2.0
    expect(current!.index).toBe(4);
    expect(current!.provisional).toBeUndefined();
    // Publishes from the FIRST differential now (rounds 1–2 provisional).
    expect(series).toHaveLength(3);
    expect(series[0].index).toBe(6); // 8.0 − 2.0, provisional
  });

  it('publishes a provisional index from the very first rated round', () => {
    const { current, series } = buildHandicapSeries([round18(80)]);
    expect(series).toHaveLength(1);
    expect(current!.provisional).toBe(true);
    expect(current!.roundsCounted).toBe(1);
    expect(current!.index).toBe(6); // sd 8.0, lowest − 2.0
  });

  it('skips 9-hole rounds until any index exists, then converts them', () => {
    const nine: EnrichedRound = {
      ...round18(41),
      holes: 9,
      gross_score: 41,
      course_rating: 35.4,
      slope_rating: 113,
      par: 36,
    };
    // 9-hole first: no prior index of any kind → skipped entirely
    const early = buildHandicapSeries([nine, round18(80), round18(85)]);
    expect(early.diffs).toHaveLength(2);
    expect(early.current!.provisional).toBe(true);

    // After a SINGLE 18-hole round the provisional index unlocks Rule 5.1b.
    const afterOne = buildHandicapSeries([round18(80), nine]);
    expect(afterOne.diffs).toHaveLength(2);
    expect(afterOne.diffs[1]).toBe(nineHoleDifferential(sd(41, 35.4, 113), 6)); // provisional 6.0

    // After three 18-hole rounds it converts with the established index.
    const later = buildHandicapSeries([round18(80), round18(85), round18(78), nine]);
    expect(later.diffs).toHaveLength(4);
    expect(later.diffs[3]).toBe(nineHoleDifferential(sd(41, 35.4, 113), 4));
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

describe('exceptionalReduction (Rule 5.9)', () => {
  it('−1 at 7.0–9.9 better, −2 at 10.0+, 0 otherwise', () => {
    expect(exceptionalReduction(13.0, 6.1)).toBe(0);    // 6.9 better → not exceptional
    expect(exceptionalReduction(13.0, 6.0)).toBe(-1);   // 7.0 better
    expect(exceptionalReduction(13.0, 3.1)).toBe(-1);   // 9.9 better
    expect(exceptionalReduction(13.0, 3.0)).toBe(-2);   // 10.0 better
    expect(exceptionalReduction(13.0, 6.5)).toBe(0);    // 6.5 better
  });
});

describe('applyCaps (Rules 5.7–5.8)', () => {
  it('passes through within 3.0 of the Low HI, and always downward', () => {
    expect(applyCaps(12.9, 10.0)).toBe(12.9);
    expect(applyCaps(13.0, 10.0)).toBe(13.0);
    expect(applyCaps(8.0, 10.0)).toBe(8.0);
  });
  it('soft cap halves the rise beyond Low HI + 3.0', () => {
    expect(applyCaps(14.0, 10.0)).toBe(13.5); // 13 + 0.5×1
    expect(applyCaps(15.0, 10.0)).toBe(14.0); // 13 + 0.5×2
  });
  it('hard cap holds at Low HI + 5.0', () => {
    expect(applyCaps(17.0, 10.0)).toBe(15.0);
    expect(applyCaps(40.0, 10.0)).toBe(15.0);
  });
});

describe('provisionalIndex', () => {
  it('null with no differentials; lowest − 2.0 for 1–2; delegates from 3', () => {
    expect(provisionalIndex([])).toBeNull();
    expect(provisionalIndex([9.0])).toEqual({ index: 7, roundsCounted: 1, diffsUsed: 1, provisional: true });
    expect(provisionalIndex([9.0, 5.0])!.index).toBe(3);
    expect(provisionalIndex([9.0, 5.0, 12.0])).toEqual(handicapIndex([9.0, 5.0, 12.0]));
  });
});

describe('buildHandicapSeries — Rule 5.9 in the record', () => {
  it('an exceptional score applies −1 to the last 20 differentials', () => {
    // Five 85s (diff 13) establish index 13.0; a 77 (diff 5, 8.0 better)
    // triggers −1 across the record: adjusted [12×5, 4] → N=6 uses lowest 2
    // with −1 → (4 + 12)/2 − 1 = 7.0. Without ESR it would be 8.0.
    const rounds = [...Array.from({ length: 5 }, () => round18(85)), round18(77)];
    expect(buildHandicapSeries(rounds).current!.index).toBe(7);
  });

  it('a 10+ better score applies −2', () => {
    // Five 13s then diff 2.0 (11.0 better): adjusted [11×5, 0] → (0+11)/2 −1 = 4.5
    const rounds = [...Array.from({ length: 5 }, () => round18(85)), round18(74)];
    expect(buildHandicapSeries(rounds).current!.index).toBe(4.5);
  });

  it('the reduction persists in the record after later normal rounds', () => {
    // Continue the −1 case with another 85: adjusted [12×5, 4, 13] →
    // N=7 uses lowest 2, no adjust → (4 + 12)/2 = 8.0.
    const rounds = [...Array.from({ length: 5 }, () => round18(85)), round18(77), round18(85)];
    expect(buildHandicapSeries(rounds).current!.index).toBe(8);
  });
});

describe('buildHandicapSeries — Low HI caps (Rules 5.7–5.8)', () => {
  it('caps the rise once 20 differentials exist (soft cap math)', () => {
    // Twenty 78s (diff 6): the established low is 4.0 (N=3 row, 6 − 2).
    // Thirteen 92s (diff 20) then lift the best-8 to (6×7 + 20)/8 = 7.75 →
    // calc 7.8, above Low 4.0 + 3.0 → soft-capped to 7 + 0.5×0.8 = 7.4.
    const rounds = [
      ...Array.from({ length: 20 }, () => round18(78)),
      ...Array.from({ length: 13 }, () => round18(92)),
    ];
    const { current, series } = buildHandicapSeries(rounds);
    expect(current!.index).toBe(7.4);
    expect(series[series.length - 1].index).toBe(7.4);
  });

  it('no caps below 20 differentials', () => {
    // Six 78s + thirteen 92s = 19 diffs → N=19 row uses the lowest 7:
    // (6×6 + 20)/7 = 8.0, published UNCAPPED because the record is one
    // short of establishment (with caps the low of 4.0 would clamp it).
    const rounds = [
      ...Array.from({ length: 6 }, () => round18(78)),
      ...Array.from({ length: 13 }, () => round18(92)),
    ];
    expect(buildHandicapSeries(rounds).current!.index).toBe(8);
  });

  it('Low HI candidates expire outside the 365-day window', () => {
    // Twenty old 78s (2024) then a fresh 92 dated >365d later: the old low
    // (4.0) is out of window, so the calc publishes uncapped.
    const rounds = [
      ...Array.from({ length: 20 }, () => round18(78, { date: '2024-01-15' })),
      round18(92, { date: '2026-06-01' }),
    ];
    const { series } = buildHandicapSeries(rounds);
    // last-20 window: [6×19, 20] → best 8 all 6s → 6.0; low out of window.
    expect(series[series.length - 1].index).toBe(6);
  });
});
