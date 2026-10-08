// Pure hole-range helpers for shared rounds (golf flow unification, PR-1).
//
// Back-9 rounds carry no schema column — they are encoded entirely by the
// hole NUMBERING in golf_scorecard_data.hole_data (holes 10–18). Viewers
// that mount the score stepper need the starting hole derived from that
// data, or hole 10 of a back-9 round renders as "Hole 1".

export interface NumberedHole {
  hole: number;
}

/**
 * Where does this round's card start? The minimum hole number in hole_data
 * when it starts past 1 (a back-9 stores 10–18); otherwise hole 1. A round
 * with no par data can't signal a back-9 start and reads as front — the
 * composer gates the back-9 choice on having hole data for exactly this
 * reason.
 */
export function startingHoleNumber(
  holeData: NumberedHole[] | null | undefined,
  holesPlayed: number | null | undefined
): number {
  if (!holeData || holeData.length === 0) return 1;
  const numbers = holeData
    .map(h => h.hole)
    .filter(n => typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= 18);
  if (numbers.length === 0) return 1;
  const min = Math.min(...numbers);
  if (min <= 1) return 1;
  // Sanity: the range must fit on an 18-hole card.
  const holes = typeof holesPlayed === 'number' && holesPlayed > 0 ? holesPlayed : numbers.length;
  return min + holes - 1 <= 18 ? min : 1;
}

/** The holes a round walks, in order: `n` holes from the starting hole
 *  (10..18 for a back nine). The map chip steps THIS list (M1) — with or
 *  without a line for each hole — never only the mapped ones. */
export function roundHoleNumbers(startHole: number, holesPlayed: number | null | undefined): number[] {
  const start = Number.isInteger(startHole) && startHole >= 1 && startHole <= 18 ? startHole : 1;
  const n = typeof holesPlayed === 'number' && holesPlayed > 0 ? Math.min(holesPlayed, 19 - start) : 19 - start;
  return Array.from({ length: n }, (_, i) => start + i);
}

/** The next hole in the list after `current`, cyclic both ways; the first
 *  hole when `current` is not in the list. Null on an empty list. */
export function stepRoundHole(list: number[], current: number | null | undefined, dir: 1 | -1): number | null {
  if (list.length === 0) return null;
  const idx = current == null ? -1 : list.indexOf(current);
  if (idx < 0) return list[0];
  return list[(idx + dir + list.length) % list.length];
export interface DerivedRoundHole {
  hole: number;
  par: number;
  yardage?: number;
  handicap?: number;
}

/**
 * Par / yardage / stroke-index rows for a hole range from a catalog course
 * (the composer's `deriveCourseHoles`, pure since H2, Oct 2026). Tee keys
 * are free text (provider tee names) — the selected tee first, then white /
 * blue, then ANY tee the course has. **An unknown yardage stays unknown:**
 * the old `?? 400` default rode into the round's hole_data as a fact and
 * then TRIMMED the hole's OSM line to 400 yards (`trimLineToYards`), cutting
 * a real 480-yard hole short on the map; downstream every reader already
 * treats a missing yardage as "fall back to the sheet, then the drawn line".
 * A catalog handicap of 0 is unknown and is left out.
 */
export function deriveCourseHoles(
  courseHoles: Array<{ number: number; par: number; yardage: Record<string, number>; handicap?: number }>,
  teeColor: string,
  holes: number,
  start: number
): DerivedRoundHole[] {
  return courseHoles
    .filter(hole => hole.number >= start && hole.number < start + holes)
    .map(hole => {
      const y = hole.yardage?.[teeColor || 'white'] ?? hole.yardage?.white ?? hole.yardage?.blue ?? Object.values(hole.yardage ?? {})[0];
      return {
        hole: hole.number,
        par: hole.par,
        ...(typeof y === 'number' && Number.isFinite(y) && y > 0 ? { yardage: y } : {}),
        ...(typeof hole.handicap === 'number' && hole.handicap > 0 ? { handicap: hole.handicap } : {}),
      };
    });
}
