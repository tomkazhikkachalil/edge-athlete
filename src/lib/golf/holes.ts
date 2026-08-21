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
