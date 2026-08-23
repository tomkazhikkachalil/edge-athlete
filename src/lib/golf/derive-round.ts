// ── Derive the recorded round from what was actually scored ──────────────────
// The 9/18 selector is gone (owner call: "whatever they record is what gets
// counted"). The composer always shows the full grid; at submit this maps
// the FILLED holes onto the existing 9/18 taxonomy — deliberately, because
// everything downstream keys on holes ∈ {9,18} (handicap eligibility,
// stats/trends filters, the possibly-still-live golf_rounds CHECK from 002):
//
//   only holes 1–9 scored  → a front-nine 9-hole round (hole_data 1–9)
//   only holes 10–18 scored → a back-nine 9-hole round (hole_data 10–18;
//                             back-9 stays encoded purely by hole NUMBERING,
//                             the same contract as before — the user filled
//                             the Back Nine tab)
//   anything else           → an 18-hole round; fewer than 18 scored is the
//                             existing partial semantics ("13 of 18")
//   nothing scored          → grid size (live rounds submit before scores)

export interface DerivedRound {
  holesPlayed: 9 | 18;
  /** Inclusive hole-number range the round's hole_data should cover. */
  startHole: number;
  endHole: number;
}

export function deriveRecordedRound(
  players: ReadonlyArray<{ hole_scores: ReadonlyArray<{ hole_number: number; strokes?: number }> }>,
  gridHoles: number
): DerivedRound {
  if (gridHoles === 9) return { holesPlayed: 9, startHole: 1, endHole: 9 };

  const filled = new Set<number>();
  for (const p of players) {
    for (const h of p.hole_scores) {
      if (h.strokes !== undefined && h.strokes > 0) filled.add(h.hole_number);
    }
  }
  if (filled.size === 0) return { holesPlayed: 18, startHole: 1, endHole: 18 };

  const nums = [...filled];
  if (nums.every(n => n <= 9)) return { holesPlayed: 9, startHole: 1, endHole: 9 };
  if (nums.every(n => n >= 10)) return { holesPlayed: 9, startHole: 10, endHole: 18 };
  return { holesPlayed: 18, startHole: 1, endHole: 18 };
}
