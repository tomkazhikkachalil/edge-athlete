// ── WHS-style handicap computation ────────────────────────────────────────────
// Score differentials and a handicap index following the World Handicap
// System's structure: differential = (113 / slope) × (gross − course rating),
// index = average of the lowest N of the most recent 20 differentials, with
// the WHS small-sample table below. This is an ESTIMATE for the athlete's own
// tracking — not an official index (no ESR/PCC adjustments, no adjusted gross
// hole caps).
//
// Eligibility: rounds with course rating + slope. 18-hole rounds count
// directly; 9-hole rounds convert via the WHS 2024 expected-score method
// (Rule 5.1b, see nineHoleDifferential) once an index exists — WHS itself
// refuses the conversion before 54 posted holes, and so do we (a wrong
// 9-hole differential is worse than exclusion). Adjusted gross (net double
// bogey) is applied upstream in buildHandicapSeries when hole-level data is
// available. Data-hygiene guards protect the lowest-N selection from
// mislabeled data (production has 9-hole rounds stored as 18 from before the
// form supported 9):
//   1. 18-hole gross must be >= 55 (the all-time real-world record);
//   2. a differential below -10 is treated as a data error (a +10 handicap
//      index is beyond elite-professional level).
// Verified against prod: a mislabeled gross-52 "18-hole" round produced a
// -15.8 differential that would have yielded a +16.8 index without these.

import { adjustedGross, courseHandicap } from './adjusted-gross';

export interface DifferentialRound {
  date: string;
  gross_score: number;
  course_rating: number;
  slope_rating: number;
  holes: number;
}

export const MIN_PLAUSIBLE_18_HOLE_GROSS = 55;
// 9-hole symmetry: the all-time 9-hole record neighborhood.
export const MIN_PLAUSIBLE_9_HOLE_GROSS = 26;
export const MIN_PLAUSIBLE_DIFFERENTIAL = -10;
// A NINE-hole course rating lives in the low-to-mid 30s; the common bad
// entry is an 18-hole rating (60s–70s) on a round logged as 9 holes —
// reject those outright rather than produce a garbage differential.
export const MIN_PLAUSIBLE_9_HOLE_RATING = 25;
export const MAX_PLAUSIBLE_9_HOLE_RATING = 45;

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

// ── 9-hole conversion (WHS 2024, Rule 5.1b) ──────────────────────────────────

/**
 * Convert a 9-hole score differential to an 18-hole one by adding the
 * player's EXPECTED differential for the unplayed nine:
 *
 *   18-hole SD = 9-hole SD + (0.52 × Handicap Index + 1.2)
 *
 * Published worked example (USGA/MGA/Golf Canada, identical): HI 14.0 with a
 * 9-hole SD of 7.2 → 7.2 + (0.52 × 14.0 + 1.2) = 15.68 → 15.7. That example
 * is the unit-test anchor.
 */
export function nineHoleDifferential(nineHoleSD: number, currentIndex: number): number {
  return Math.round((nineHoleSD + 0.52 * currentIndex + 1.2) * 10) / 10;
}

/** 9-hole eligibility (rating/slope are the NINE-hole values). */
export function isNineHoleEligible(r: {
  holes: number;
  gross_score: number | null;
  course_rating: number | null;
  slope_rating: number | null;
}): boolean {
  return (
    r.holes === 9 &&
    typeof r.gross_score === 'number' &&
    r.gross_score >= MIN_PLAUSIBLE_9_HOLE_GROSS &&
    typeof r.course_rating === 'number' &&
    r.course_rating >= MIN_PLAUSIBLE_9_HOLE_RATING &&
    r.course_rating <= MAX_PLAUSIBLE_9_HOLE_RATING &&
    typeof r.slope_rating === 'number' &&
    r.slope_rating >= 55 &&
    r.slope_rating <= 155
  );
}

// ── The chronological series builder ─────────────────────────────────────────

export interface EnrichedRound {
  date: string;
  holes: number; // 9 | 18
  gross_score: number | null;
  course_rating: number | null;
  slope_rating: number | null;
  /** The round's par (golf_rounds.par) — needed for Course Handicap. */
  par: number | null;
  /** Hole-level scores when recorded; null → raw gross is used unchanged. */
  holeScores: Array<{ par: number; strokes: number }> | null;
  /** Stroke indexes positionally parallel to holeScores (already re-ranked
   *  for subsets); null → allocation unknown. */
  allocations: Array<number | null> | null;
}

export interface HandicapSeriesResult {
  /** Chronological differentials that entered the computation. */
  diffs: number[];
  /** Index after each counted round (from the 3rd differential on). */
  series: Array<{ date: string; index: number }>;
  current: HandicapResult | null;
}

/**
 * Walk rounds chronologically, computing each round's differential with the
 * WHS refinements the data allows at that point in time:
 *
 *  - adjusted gross (net double bogey) when hole-level scores exist — the
 *    cap uses the index AS OF that round (prior rounds only), which is why
 *    this must be a chronological recompute and never a stored column;
 *  - 9-hole rounds convert via Rule 5.1b, but only once a prior index
 *    exists (WHS's own bootstrap rule) — otherwise they are skipped;
 *  - rounds without hole data use raw gross, byte-identical to the
 *    pre-upgrade behavior.
 */
export function buildHandicapSeries(rounds: EnrichedRound[]): HandicapSeriesResult {
  const diffs: number[] = [];
  const series: Array<{ date: string; index: number }> = [];

  for (const r of rounds) {
    const is18 = r.holes === 18;
    if (is18 ? !isHandicapEligibleGross(r) : !isNineHoleEligible(r)) continue;

    const priorIndex = handicapIndex(diffs)?.index ?? null;
    if (!is18 && priorIndex === null) continue; // WHS bootstrap rule

    let gross = r.gross_score as number;
    if (r.holeScores && r.holeScores.length > 0) {
      const effectiveIndex = priorIndex === null ? null : is18 ? priorIndex : priorIndex / 2;
      const ch =
        effectiveIndex === null || r.par === null
          ? null
          : courseHandicap(effectiveIndex, r.slope_rating as number, r.course_rating as number, r.par);
      gross = adjustedGross(r.holeScores, r.allocations, ch);
    }

    const sd = scoreDifferential(gross, r.course_rating as number, r.slope_rating as number);
    const diff = is18 ? sd : nineHoleDifferential(sd, priorIndex as number);
    // Plausibility floor applies to the FINAL differential either way.
    if (diff < MIN_PLAUSIBLE_DIFFERENTIAL) continue;

    diffs.push(diff);
    const result = handicapIndex(diffs);
    if (result) series.push({ date: r.date, index: result.index });
  }

  return { diffs, series, current: handicapIndex(diffs) };
}

/** The original 18-hole gross-level guards, minus the differential check
 *  (buildHandicapSeries applies the floor to the FINAL differential, which
 *  for adjusted-gross rounds differs from the raw-gross one). */
function isHandicapEligibleGross(r: {
  holes: number;
  gross_score: number | null;
  course_rating: number | null;
  slope_rating: number | null;
}): boolean {
  return (
    r.holes === 18 &&
    typeof r.gross_score === 'number' &&
    r.gross_score >= MIN_PLAUSIBLE_18_HOLE_GROSS &&
    typeof r.course_rating === 'number' &&
    r.course_rating > 0 &&
    typeof r.slope_rating === 'number' &&
    r.slope_rating >= 55 &&
    r.slope_rating <= 155
  );
}
