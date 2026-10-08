// ── The course at a glance (Golf course flow fixes M3, Oct 2026) ────────────
// Tom: a BOLD summary at the top of a course — hole count, total yardage per
// tee, slope and rating, a map thumbnail labelled "View course map" — and an
// explicit "Not fully mapped" state instead of a half-empty preview. Pure,
// zero React: the card renders what these two functions say.

import type { CourseHole, GolfCourse } from '@/types/golf';
import { courseTeeOptions, teeLabel } from '@/lib/golf/tees';

export interface TeeTotal {
  key: string;
  label: string;
  /** The sum of the tee's per-hole yardage — null when ANY hole lacks it
   *  (CourseScorecardTable's sparse rule): never a partial sum. */
  yards: number | null;
  rating: number | null;
  slope: number | null;
}

export interface CourseSummary {
  holeCount: number | null;
  par: number | null;
  /** In the tee sheet's order (rated tees hardest first); the tee in play
   *  first of all when one is named. */
  tees: TeeTotal[];
}

export function courseSummary(
  course: Pick<GolfCourse, 'holes' | 'holesCount' | 'totalPar' | 'courseRating' | 'slopeRating'>,
  teeInPlay?: string | null
): CourseSummary {
  const holes = course.holes ?? [];
  const holeCount = holes.length > 0 ? holes.length : course.holesCount ?? null;
  const everyPar = holes.length > 0 && holes.every(h => typeof h.par === 'number' && h.par > 0);
  const par = everyPar ? holes.reduce((s, h) => s + h.par, 0) : typeof course.totalPar === 'number' && course.totalPar > 0 ? course.totalPar : null;
  const keys = courseTeeOptions(course).filter(k => {
    const rated = course.courseRating?.[k] !== undefined || course.slopeRating?.[k] !== undefined;
    const onCard = holes.some(h => typeof h.yardage?.[k] === 'number');
    return rated || onCard;
  });
  const tees: TeeTotal[] = keys.map(key => {
    const ys = holes.map(h => h.yardage?.[key]);
    const complete = holes.length > 0 && ys.every(y => typeof y === 'number' && Number.isFinite(y) && y > 0);
    return {
      key,
      label: teeLabel(key),
      yards: complete ? ys.reduce((s, y) => s + (y as number), 0) : null,
      rating: typeof course.courseRating?.[key] === 'number' ? course.courseRating[key] : null,
      slope: typeof course.slopeRating?.[key] === 'number' ? course.slopeRating[key] : null,
    };
  });
  if (teeInPlay) tees.sort((a, b) => Number(b.key === teeInPlay) - Number(a.key === teeInPlay));
  return { holeCount, par, tees };
}

export type MappingGap = 'no-hole-data' | 'no-yardage-for-tee' | 'no-map-lines' | 'greens-only' | 'pick-a-nine';

/** What is missing, each named once. `geometry` undefined = not asked yet
 *  (no claim is made); null = asked, none. */
export function mappingGaps(input: {
  holes: CourseHole[];
  teeInPlay?: string | null;
  geometry: Array<{ line: [number, number][] }> | null | undefined;
  /** PR 3: no lines, but the greens are drawn — a different, softer gap. */
  greensOnly?: boolean;
  /** PR 4: the club's nines are mapped but unlabelled — pick one on the map. */
  sections?: number;
}): MappingGap[] {
  const gaps: MappingGap[] = [];
  if (input.holes.length === 0) gaps.push('no-hole-data');
  else if (input.teeInPlay && !input.holes.every(h => typeof h.yardage?.[input.teeInPlay!] === 'number' && h.yardage[input.teeInPlay!] > 0)) {
    gaps.push('no-yardage-for-tee');
  }
  if (input.geometry === null || (Array.isArray(input.geometry) && input.geometry.length === 0)) {
    gaps.push(input.sections && input.sections >= 2 ? 'pick-a-nine' : input.greensOnly ? 'greens-only' : 'no-map-lines');
  }
  return gaps;
}
