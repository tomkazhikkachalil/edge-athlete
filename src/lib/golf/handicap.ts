// ── WHS-style handicap computation ────────────────────────────────────────────
// Score differentials and a handicap index following the World Handicap
// System's structure: differential = (113 / slope) × (gross − course rating),
// index = average of the lowest N of the most recent 20 differentials, with
// the WHS small-sample table below. This is an ESTIMATE for the athlete's own
// tracking — not an official index (no ESR/PCC adjustments, no adjusted gross
// hole caps).
//
// Eligibility: 18-hole rounds with course rating + slope. 9-hole rounds are
// excluded for now (WHS 9-hole expected-differential handling is a later
// enhancement). Two data-hygiene guards protect the lowest-N selection from
// mislabeled data (production has 9-hole rounds stored as 18 from before the
// form supported 9):
//   1. 18-hole gross must be >= 55 (the all-time real-world record);
//   2. a differential below -10 is treated as a data error (a +10 handicap
//      index is beyond elite-professional level).
// Verified against prod: a mislabeled gross-52 "18-hole" round produced a
// -15.8 differential that would have yielded a +16.8 index without these.

export interface DifferentialRound {
  date: string;
  gross_score: number;
  course_rating: number;
  slope_rating: number;
  holes: number;
}

export const MIN_PLAUSIBLE_18_HOLE_GROSS = 55;
export const MIN_PLAUSIBLE_DIFFERENTIAL = -10;

export function isHandicapEligible(r: {
  holes: number;
  gross_score: number | null;
  course_rating: number | null;
  slope_rating: number | null;
}): boolean {
  return (
    r.holes === 18 &&
    typeof r.gross_score === 'number' &&
    r.gross_score >= MIN_PLAUSIBLE_18_HOLE_GROSS &&
    // differential plausibility (guards bad rating/slope entries too)
    typeof r.course_rating === 'number' &&
    typeof r.slope_rating === 'number' &&
    r.slope_rating > 0 &&
    scoreDifferential(r.gross_score, r.course_rating, r.slope_rating) >= MIN_PLAUSIBLE_DIFFERENTIAL &&
    typeof r.course_rating === 'number' &&
    r.course_rating > 0 &&
    typeof r.slope_rating === 'number' &&
    r.slope_rating >= 55 &&
    r.slope_rating <= 155
  );
}

/** (113 / slope) × (gross − rating), rounded to 1 decimal. */
export function scoreDifferential(gross: number, rating: number, slope: number): number {
  return Math.round(((113 / slope) * (gross - rating)) * 10) / 10;
}

// WHS table: for N available differentials (of the last 20), use the lowest
// `use` and apply `adjust` strokes.
const WHS_TABLE: Array<{ min: number; max: number; use: number; adjust: number }> = [
  { min: 3, max: 3, use: 1, adjust: -2.0 },
  { min: 4, max: 4, use: 1, adjust: -1.0 },
  { min: 5, max: 5, use: 1, adjust: 0 },
  { min: 6, max: 6, use: 2, adjust: -1.0 },
  { min: 7, max: 8, use: 2, adjust: 0 },
  { min: 9, max: 11, use: 3, adjust: 0 },
  { min: 12, max: 14, use: 4, adjust: 0 },
  { min: 15, max: 16, use: 5, adjust: 0 },
  { min: 17, max: 18, use: 6, adjust: 0 },
  { min: 19, max: 19, use: 7, adjust: 0 },
  { min: 20, max: Infinity, use: 8, adjust: 0 },
];

export interface HandicapResult {
  index: number;          // the handicap index (1 decimal, capped at 54.0)
  roundsCounted: number;  // differentials considered (max 20)
  diffsUsed: number;      // how many lowest differentials were averaged
}

/**
 * Handicap index from CHRONOLOGICAL differentials (oldest → newest).
 * Uses the most recent 20; returns null with fewer than 3.
 */
export function handicapIndex(chronologicalDiffs: number[]): HandicapResult | null {
  const recent = chronologicalDiffs.slice(-20);
  if (recent.length < 3) return null;

  const row = WHS_TABLE.find(r => recent.length >= r.min && recent.length <= r.max)!;
  const lowest = [...recent].sort((a, b) => a - b).slice(0, row.use);
  const avg = lowest.reduce((s, d) => s + d, 0) / lowest.length;
  const raw = avg + row.adjust;
  const capped = Math.min(raw, 54);

  return {
    index: Math.round(capped * 10) / 10,
    roundsCounted: recent.length,
    diffsUsed: row.use,
  };
}

/** Format an index for display: 4.2 → "4.2", −1.5 → "+1.5" (plus handicap). */
export function formatHandicapIndex(index: number): string {
  return index < 0 ? `+${Math.abs(index).toFixed(1)}` : index.toFixed(1);
}
