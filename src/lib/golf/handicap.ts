// ── WHS handicap computation ─────────────────────────────────────────────────
// A complete implementation of the World Handicap System's player-record
// arithmetic: score differentials ((113 / slope) × (adjusted gross − course
// rating)), the small-sample table, best-8-of-20, net double bogey hole caps
// (Rule 3.1b, in adjusted-gross.ts), the 9-hole expected-score conversion
// (Rule 5.1b), Exceptional Score Reductions (Rule 5.9), and the Low
// Handicap Index soft/hard caps (Rules 5.7–5.8).
//
// STILL AN ESTIMATE, for one precise reason: PCC (the daily Playing
// Conditions Calculation) requires the scores of every player at the course
// that day — data only the handicap-association network holds — and an
// official Handicap Index® is an issued credential, not just correct math.
// Everything computable from the athlete's own record IS computed.
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
  /** True below 3 differentials — WHS itself has no index yet; we extend the
   *  table's own conservative pattern (lowest − 2.0) so the athlete sees a
   *  number from their FIRST rated round, clearly marked provisional. */
  provisional?: boolean;
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

/**
 * Like handicapIndex, but never waits: with 1–2 differentials it extends the
 * WHS small-sample table's own most-conservative row (lowest − 2.0, the
 * N=3 treatment) and marks the result `provisional`. Strict WHS behavior is
 * untouched — from 3 differentials this delegates to handicapIndex.
 */
export function provisionalIndex(chronologicalDiffs: number[]): HandicapResult | null {
  const recent = chronologicalDiffs.slice(-20);
  if (recent.length === 0) return null;
  if (recent.length >= 3) return handicapIndex(chronologicalDiffs);

  const best = Math.min(...recent);
  const capped = Math.min(best - 2.0, 54);
  return {
    index: Math.round(capped * 10) / 10,
    roundsCounted: recent.length,
    diffsUsed: 1,
    provisional: true,
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

// ── Exceptional Score Reduction (Rule 5.9) ───────────────────────────────────

/** ESR trigger: a differential 7.0+ strokes better than the player's index
 *  at the time the round was played. Returns the per-differential adjustment
 *  (−1.0 for 7.0–9.9 better, −2.0 for 10.0+), or 0 when not exceptional. */
export function exceptionalReduction(indexAtTime: number, differential: number): number {
  const better = Math.round((indexAtTime - differential) * 10) / 10;
  if (better >= 10.0) return -2.0;
  if (better >= 7.0) return -1.0;
  return 0;
}

// ── Low Handicap Index caps (Rules 5.7–5.8) ──────────────────────────────────

/** Days the Low HI looks back from the most recent round. */
export const LOW_HI_WINDOW_DAYS = 365;
/** Scores required before a Low HI is established and the caps engage. */
export const LOW_HI_ESTABLISHED_AT = 20;
export const SOFT_CAP_ABOVE_LOW = 3.0;
export const HARD_CAP_ABOVE_LOW = 5.0;

/** Whole days between two ISO dates (UTC-anchored; date-only strings). */
function daysBetween(earlierIso: string, laterIso: string): number {
  const a = new Date(`${earlierIso}T00:00:00Z`).getTime();
  const b = new Date(`${laterIso}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * Rule 5.8: caps restrict UPWARD movement only. Above Low HI + 3.0 the rise
 * is halved (soft cap); the published index never exceeds Low HI + 5.0
 * (hard cap). Downward movement is never limited.
 */
export function applyCaps(calculated: number, lowHI: number): number {
  if (calculated - lowHI <= SOFT_CAP_ABOVE_LOW) return calculated;
  const softened = lowHI + SOFT_CAP_ABOVE_LOW + 0.5 * (calculated - lowHI - SOFT_CAP_ABOVE_LOW);
  const capped = Math.min(softened, lowHI + HARD_CAP_ABOVE_LOW);
  return Math.round(capped * 10) / 10;
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
  /** Published index after EVERY counted round (provisional from the 1st
   *  differential; provisional entries never anchor the Low HI caps). */
  series: Array<{ date: string; index: number; provisional?: boolean }>;
  current: HandicapResult | null;
}

/**
 * Walk rounds chronologically, computing each round's differential with the
 * full set of WHS refinements the data allows at that point in time:
 *
 *  - adjusted gross (net double bogey / par+5 pre-index) when hole-level
 *    scores exist — the cap uses the PUBLISHED index as of that round,
 *    which is why this must be a chronological recompute and never a
 *    stored column;
 *  - 9-hole rounds convert via Rule 5.1b once any prior index exists
 *    (provisional included) — otherwise they are skipped;
 *  - Exceptional Score Reductions (Rule 5.9): a differential 7.0+/10.0+
 *    strokes better than the published index at the time applies −1/−2 to
 *    the 20 most recent differentials, the new one included, and those
 *    adjusted values persist in the record;
 *  - Low HI soft/hard caps (Rules 5.7–5.8) once the record reaches 20
 *    differentials: Low HI is the lowest PUBLISHED index in the 365 days
 *    before the round being posted;
 *  - a provisional index is published from the FIRST differential (see
 *    provisionalIndex) so the athlete never stares at an empty slot;
 *  - rounds without hole data use raw gross, as before.
 */
export function buildHandicapSeries(rounds: EnrichedRound[]): HandicapSeriesResult {
  const diffs: number[] = [];          // raw chronological differentials
  const esrAdjust: number[] = [];      // Rule 5.9 adjustments, parallel to diffs
  const series: Array<{ date: string; index: number; provisional?: boolean }> = [];
  let published: HandicapResult | null = null;

  const adjusted = () => diffs.map((d, i) => d + esrAdjust[i]);

  for (const r of rounds) {
    const is18 = r.holes === 18;
    if (is18 ? !isHandicapEligibleGross(r) : !isNineHoleEligible(r)) continue;

    const priorIndex = published?.index ?? null;
    if (!is18 && priorIndex === null) continue; // 9-hole needs some index to convert

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
    esrAdjust.push(0);

    // Rule 5.9 — judged against the index at the time the round was played.
    if (priorIndex !== null) {
      const reduction = exceptionalReduction(priorIndex, diff);
      if (reduction !== 0) {
        const from = Math.max(0, diffs.length - 20);
        for (let i = from; i < diffs.length; i++) esrAdjust[i] += reduction;
      }
    }

    const calc = provisionalIndex(adjusted());
    if (!calc) continue; // unreachable: diffs is non-empty

    // Rules 5.7–5.8 — caps engage once the record holds 20 differentials.
    // Provisional (sub-3) entries are our extension, never WHS values, so
    // they are excluded from the Low HI candidates.
    let index = calc.index;
    if (diffs.length >= LOW_HI_ESTABLISHED_AT) {
      const inWindow = series.filter(
        s => !s.provisional && daysBetween(s.date, r.date) <= LOW_HI_WINDOW_DAYS
      );
      if (inWindow.length > 0) {
        const lowHI = Math.min(...inWindow.map(s => s.index));
        index = applyCaps(index, lowHI);
      }
    }

    published = { ...calc, index };
    series.push(
      calc.provisional ? { date: r.date, index, provisional: true } : { date: r.date, index }
    );
  }

  return { diffs, series, current: published };
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
