// ── Course-driven tee options ────────────────────────────────────────────────
// A catalog course carries per-tee ratings/slopes/yardages keyed by the
// course's REAL tee names ("championship", "blue", "silver", "blue (f)").
// The composer's tee dropdown offers those when a course is selected —
// picking one auto-fills its exact rating/slope and per-hole yardages.
// Custom/history courses (no tee data) fall back to the classic five colors.

import type { GolfCourse } from '@/types/golf';

export const FALLBACK_TEES = ['black', 'blue', 'white', 'gold', 'red'] as const;

/** Union of every tee key the course knows, hardest first (by course
 *  rating descending — the conventional tee-sheet order), unknown-rating
 *  keys last in stable order. */
export function courseTeeOptions(course: Pick<GolfCourse, 'courseRating' | 'slopeRating' | 'holes'> | null): string[] {
  if (!course) return [...FALLBACK_TEES];
  const keys = new Set<string>([
    ...Object.keys(course.courseRating ?? {}),
    ...Object.keys(course.slopeRating ?? {}),
  ]);
  for (const h of course.holes ?? []) {
    for (const k of Object.keys(h.yardage ?? {})) keys.add(k);
  }
  if (keys.size === 0) return [...FALLBACK_TEES];
  const rated = [...keys].filter(k => course.courseRating?.[k] !== undefined);
  const unrated = [...keys].filter(k => course.courseRating?.[k] === undefined);
  rated.sort((a, b) => (course.courseRating![b] ?? 0) - (course.courseRating![a] ?? 0));
  return [...rated, ...unrated];
}

/** "blue (f)" → "Blue (F)", "championship" → "Championship". */
export function teeLabel(key: string): string {
  return key.replace(/\b[a-z]/g, c => c.toUpperCase());
}

// ── Provider sub-course name tidy ────────────────────────────────────────────
// OpenGolfAPI names nine-combos and numbered courses like "1 At Ponkapoag
// Golf Club" or "10 19 At University Park Country Club" — alphabetically
// they sort as noise and read as data errors. Reshape to
// "Ponkapoag Golf Club (Course 1)" / "University Park Country Club
// (Nines 10 & 19)". Anything not matching the pattern passes through.
export function tidyCourseName(name: string): string {
  const m = /^(\d{1,2})(?:[\s/]+(\d{1,2}))?\s+at\s+(.+)$/i.exec(name.trim());
  if (!m) return name;
  const [, a, b, club] = m;
  return b ? `${club} (Nines ${a} & ${b})` : `${club} (Course ${a})`;
}
