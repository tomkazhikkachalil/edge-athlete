// ── Multi-course clubs: nine/section composition (migration 125) ───────────
// A club can hold several playable layouts; each SECTION is its own
// golf_courses row (an 18, or an individual nine). An 18-hole round on a
// 27-hole club is TWO chosen nines, numbered 1–18 on the scorecard exactly
// the way WHS rates 18-hole combinations: front nine = holes 1–9 verbatim,
// back nine renumbered 10–18. This module is pure (unit-tested, shared
// client/server): the composed course LOOKS like a normal 18-hole catalog
// course, so applyCourseData / deriveCourseHoles / the tee ladder / the
// scorecard grid all work on it unchanged.

import type { CourseHole, GolfCourse } from '@/types/golf';
import {
  MIN_PLAUSIBLE_9_HOLE_RATING,
  MAX_PLAUSIBLE_9_HOLE_RATING,
} from './handicap';

/** One side of a combo, as persisted in golf_scorecard_data.course_composition. */
export interface CompositionEntry {
  course_id: string;
  section_name: string | null;
  holes: '1-9' | '10-18';
}

export type CourseComposition = CompositionEntry[];

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate a raw course_composition value (from the client or the DB).
 * Returns null for anything malformed — callers treat null as "no
 * composition" (a normal single-course round), never as an error.
 * Exactly two entries, one per half, distinct course ids.
 */
export function parseComposition(raw: unknown): CourseComposition | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const seen = new Set<string>();
  const out: CompositionEntry[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null;
    const { course_id, section_name, holes } = item as Record<string, unknown>;
    if (typeof course_id !== 'string' || !UUID_SHAPE.test(course_id)) return null;
    if (holes !== '1-9' && holes !== '10-18') return null;
    if (section_name !== null && section_name !== undefined && typeof section_name !== 'string') return null;
    out.push({
      course_id,
      section_name: typeof section_name === 'string' ? section_name : null,
      holes,
    });
    seen.add(holes);
  }
  if (!seen.has('1-9') || !seen.has('10-18')) return null;
  if (out[0].course_id === out[1].course_id) return null;
  // Canonical order: front first.
  out.sort((a, b) => (a.holes === '1-9' ? -1 : 1) - (b.holes === '1-9' ? -1 : 1));
  return out;
}

interface NineRatings {
  rating?: number;
  slope?: number;
}

/**
 * WHS combination math for one tee: an 18-hole Course Rating is the SUM of
 * the two nines' ratings; the 18-hole Slope is the AVERAGE of the two
 * nines' slopes, rounded to the nearest whole number. Either side missing
 * or implausible → that piece is undefined (never fabricate a rating).
 */
export function combineNineRatings(front: NineRatings, back: NineRatings): NineRatings {
  const plausible = (r: number | undefined): r is number =>
    typeof r === 'number' &&
    r >= MIN_PLAUSIBLE_9_HOLE_RATING &&
    r <= MAX_PLAUSIBLE_9_HOLE_RATING;
  const plausibleSlope = (s: number | undefined): s is number =>
    typeof s === 'number' && s >= 55 && s <= 155; // USGA slope bounds
  return {
    rating: plausible(front.rating) && plausible(back.rating)
      ? Math.round((front.rating + back.rating) * 10) / 10
      : undefined,
    slope: plausibleSlope(front.slope) && plausibleSlope(back.slope)
      ? Math.round((front.slope + back.slope) / 2)
      : undefined,
  };
}

/** Tees present on BOTH nines, with combined rating/slope per tee. */
function combineTeeMaps(
  front: GolfCourse,
  back: GolfCourse
): { courseRating: Record<string, number>; slopeRating: Record<string, number> } {
  const courseRating: Record<string, number> = {};
  const slopeRating: Record<string, number> = {};
  const tees = Object.keys(front.courseRating ?? {}).filter(
    tee => tee in (back.courseRating ?? {})
  );
  for (const tee of tees) {
    const combined = combineNineRatings(
      { rating: front.courseRating?.[tee], slope: front.slopeRating?.[tee] },
      { rating: back.courseRating?.[tee], slope: back.slopeRating?.[tee] }
    );
    if (combined.rating !== undefined) courseRating[tee] = combined.rating;
    if (combined.slope !== undefined) slopeRating[tee] = combined.slope;
  }
  return { courseRating, slopeRating };
}

/** Holes 1–9 of a nine-section row (defensive filter, sorted). */
function nineHoles(course: GolfCourse): CourseHole[] {
  return (course.holes ?? [])
    .filter(h => h.number >= 1 && h.number <= 9)
    .slice()
    .sort((a, b) => a.number - b.number);
}

/**
 * Compose two nine-section rows into one 18-hole GolfCourse: front holes
 * 1–9 verbatim, back holes renumbered +9 (yardage/handicap carried as-is —
 * duplicate stroke indexes across the halves are fine, rankStrokeIndexes in
 * adjusted-gross.ts re-ranks by relative order). id = the FRONT nine's row,
 * matching the course_id convention for combo rounds. When either side lacks
 * a full nine of hole data (thin/OSM sections), the compose degrades to an
 * IDENTITY-ONLY course — empty holes, default par — exactly how a thin OSM
 * row behaves today (manual par entry takes over); it never invents holes.
 */
export function composeCourses(
  front: GolfCourse,
  back: GolfCourse,
  clubName?: string
): GolfCourse {
  const frontHoles = nineHoles(front);
  const backHoles = nineHoles(back);
  const fullData = frontHoles.length === 9 && backHoles.length === 9;
  const holes: CourseHole[] = fullData
    ? [...frontHoles, ...backHoles.map(h => ({ ...h, number: h.number + 9 }))]
    : [];
  const totalPar = fullData ? holes.reduce((sum, h) => sum + h.par, 0) : 72;
  const { courseRating, slopeRating } = combineTeeMaps(front, back);
  const frontLabel = front.sectionName ?? front.name;
  const backLabel = back.sectionName ?? back.name;
  return {
    ...front,
    id: front.id,
    name: clubName
      ? `${clubName} (${frontLabel} & ${backLabel})`
      : `${frontLabel} & ${backLabel}`,
    holes,
    totalPar,
    holesCount: 18,
    courseRating,
    slopeRating,
    sectionName: undefined,
    sectionKind: undefined,
  };
}

/** The composition record for a front/back nine pairing. */
export function buildComposition(front: GolfCourse, back: GolfCourse): CourseComposition {
  return [
    { course_id: front.id, section_name: front.sectionName ?? null, holes: '1-9' },
    { course_id: back.id, section_name: back.sectionName ?? null, holes: '10-18' },
  ];
}
