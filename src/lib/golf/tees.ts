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

// ── The tee table (the mechanical dialect, Nov 23 2026) ─────────────────────
// Tom's visual spec: the tee picker is a table. It had a Men | Women switch
// in place of the separate "(F)" rows until Nov 27 2026; a round now lists
// the men's boxes only (roundTeeKeys). The catalog marks a women's box only
// where its key collides with a men's one — that " (f)" suffix (rowToCourse)
// — so that is what the sides are split on.

const WOMENS_SUFFIX = / \(f\)$/i;

export function isWomensTee(key: string): boolean {
  return WOMENS_SUFFIX.test(key);
}

/** The tee keys by side, each in the given (tee-sheet) order. */
export function splitTeeSides(keys: readonly string[]): { men: string[]; women: string[] } {
  return { men: keys.filter(k => !isWomensTee(k)), women: keys.filter(isWomensTee) };
}

/** A round's tee list: the men's boxes, always. There is no Men | Women
 *  switch (Tom: indoor rounds Nov 27 2026, every round later that day — "it
 *  should just be defaulted to mens where it just shows the yardage"). A
 *  course that only has women's boxes shows those, so a tee can always be
 *  picked. */
export function roundTeeKeys(keys: readonly string[]): string[] {
  const { men } = splitTeeSides(keys);
  return men.length > 0 ? men : [...keys];
}

/** A row's name under the switch: the side is the switch's to say, so the
 *  "(F)" is dropped — "blue (f)" → "Blue". */
export function teeRowLabel(key: string): string {
  return teeLabel(key.replace(WOMENS_SUFFIX, ''));
}

/** The dot beside a tee: the spec's five colours and the other names courses
 *  commonly use; a name that is not a colour ("championship", "member")
 *  gets null — a hollow dot, never a guessed colour. */
const TEE_DOT: Readonly<Record<string, string>> = {
  black: '#0B0B0D',
  gold: '#D4A72C',
  blue: '#3B82F6',
  white: '#EDEDED',
  red: '#E5484D',
  green: '#3FA36B',
  yellow: '#E8C534',
  silver: '#B8BCC6',
  orange: '#F08A3C',
  purple: '#8B5CF6',
  copper: '#B87333',
  bronze: '#B08D57',
  grey: '#8A8F98',
  gray: '#8A8F98',
};

export function teeDotColour(key: string): string | null {
  const base = key.replace(WOMENS_SUFFIX, '').trim().toLowerCase();
  if (TEE_DOT[base]) return TEE_DOT[base];
  const word = base.split(/[\s/-]+/).find(w => TEE_DOT[w]);
  return word ? TEE_DOT[word] : null;
}

/** Whether the round still needs its rating and slope TYPED (Tom, Nov 23:
 *  "make it dynamic so it follows real data"): a course with no catalog row
 *  (typed by hand), and a catalog course that cannot answer for the tee in
 *  play — or for any tee, when none is chosen. A course whose card has both
 *  numbers for the tee shows them on the dials and asks for nothing. */
export function ratingEntryNeeded(
  course: Pick<GolfCourse, 'courseRating' | 'slopeRating'> | null,
  tee: string,
): boolean {
  if (!course) return true;
  const rating = course.courseRating ?? {};
  const slope = course.slopeRating ?? {};
  if (tee) return typeof rating[tee] !== 'number' || typeof slope[tee] !== 'number';
  return Object.keys(rating).length === 0 || Object.keys(slope).length === 0;
}

// ── Provider sub-course name tidy ────────────────────────────────────────────
// OpenGolfAPI names nine-combos and numbered courses like "1 At Ponkapoag
// Golf Club" or "10 19 At University Park Country Club" — alphabetically
// they sort as noise and read as data errors. Reshape to
// "Ponkapoag Golf Club (Course 1)" / "University Park Country Club
// (Nines 10 & 19)". Anything not matching the pattern passes through.
/** "{club} – {course}" unless the course name already carries the club. */
export function courseDisplayName(clubName: string | null | undefined, courseName: string): string {
  const club = (clubName ?? '').trim();
  const course = courseName.trim();
  if (!club || course.toLowerCase().includes(club.toLowerCase())) return course;
  return `${club} – ${course}`;
}

export function tidyCourseName(name: string): string {
  const m = /^(\d{1,2})(?:[\s/]+(\d{1,2}))?\s+at\s+(.+)$/i.exec(name.trim());
  if (!m) return name;
  const [, a, b, club] = m;
  return b ? `${club} (Nines ${a} & ${b})` : `${club} (Course ${a})`;
}
