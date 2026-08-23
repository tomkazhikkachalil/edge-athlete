// ── WHS adjusted gross (net double bogey) ────────────────────────────────────
// Pure Rules-of-Handicapping arithmetic feeding the handicap estimate:
//
//   Rule 3.1b — a hole's maximum counted score is par + 2 + the handicap
//     strokes RECEIVED on that hole; a player with NO Handicap Index caps
//     every hole at par + 5 instead.
//   Rule 6.1a — Course Handicap = HI × (slope / 113) + (CR − par), rounded
//     to the nearest whole number. (9-hole rounds use HI/2 with the 9-hole
//     rating/slope/par — the CALLER halves the index.)
//
// Stroke allocation follows the standard stroke-index scheme: a course
// handicap of CH gives floor(CH/18) strokes on every hole plus one extra on
// the holes whose stroke index ≤ CH mod 18. A PLUS player (negative CH)
// gives strokes back starting at stroke index 18 and counting down.
//
// Stroke indexes come from the course catalog (golf_courses.hole_data[]
// .handicap via golf_rounds.course_id); providers sometimes omit them
// (normalized to 0) — 0/null means "allocation unknown". With a known CH but
// unknown allocation we DEGRADE deliberately high: every hole is capped at
// par + 2 + ceil(CH/18) (clamped to ≥ par + 2 for plus players). That cap is
// ≥ the true WHS cap on every hole, so the adjusted gross is ≥ the true
// adjusted gross and the estimated index errs HIGH — an unofficial estimate
// must never flatter the player.
//
// No I/O and no Supabase types here — everything is node-unit-testable.

/** Rule 6.1a: Course Handicap, rounded to nearest whole number. */
export function courseHandicap(index: number, slope: number, rating: number, par: number): number {
  return Math.round(index * (slope / 113) + (rating - par));
}

/** Handicap strokes received on a hole with stroke index `si` (1–18). */
export function strokesForHole(courseHcp: number, strokeIndex: number): number {
  if (courseHcp >= 0) {
    const base = Math.floor(courseHcp / 18);
    return base + (strokeIndex <= courseHcp % 18 ? 1 : 0);
  }
  // Plus player: give back |CH| strokes starting at stroke index 18.
  const give = Math.abs(courseHcp);
  const back = Math.floor(give / 18) + (strokeIndex > 18 - (give % 18) ? 1 : 0);
  return back === 0 ? 0 : -back; // never -0
}

/**
 * Re-rank a played subset's raw stroke indexes to a 1..N relative order —
 * a 9-hole round at an 18-hole course has raw indexes like [3, 7, 11, …]
 * that must allocate as if they were 1..9. Unknown entries (0/null) stay
 * null, and any unknown makes ONLY that hole unknown, not the whole set.
 */
export function rankStrokeIndexes(allocations: Array<number | null>): Array<number | null> {
  const known = allocations
    .map((si, i) => ({ si, i }))
    .filter((x): x is { si: number; i: number } => typeof x.si === 'number' && x.si > 0);
  const sorted = [...known].sort((a, b) => a.si - b.si);
  const rankByPosition = new Map<number, number>();
  sorted.forEach((x, rank) => rankByPosition.set(x.i, rank + 1));
  return allocations.map((si, i) =>
    typeof si === 'number' && si > 0 ? (rankByPosition.get(i) ?? null) : null
  );
}

export interface AdjustableHole {
  par: number;
  strokes: number;
}

/**
 * WHS adjusted gross for a round.
 *
 * - `courseHcp === null` (no established index yet): every hole caps at
 *   par + 5 (Rule 3.1b's players-without-an-index rule).
 * - CH known + stroke index known for a hole: exact net double bogey.
 * - CH known + stroke index unknown for a hole: the deliberate high degrade
 *   (header comment) — par + 2 + max(0, ceil(CH/18)).
 *
 * `allocations` is positionally parallel to `holes` (already re-ranked via
 * rankStrokeIndexes when the round is a subset of the course's holes); pass
 * null when nothing is known about the course's stroke indexes.
 */
export function adjustedGross(
  holes: AdjustableHole[],
  allocations: Array<number | null> | null,
  courseHcp: number | null
): number {
  let total = 0;
  for (let i = 0; i < holes.length; i++) {
    const { par, strokes } = holes[i];
    let cap: number;
    if (courseHcp === null) {
      cap = par + 5;
    } else {
      const si = allocations?.[i] ?? null;
      cap =
        si !== null
          ? par + 2 + strokesForHole(courseHcp, si)
          : par + 2 + Math.max(0, Math.ceil(courseHcp / 18));
      // A plus player's cap can compute below par + 2 only via a real
      // allocation; never let the degrade path go under net double bogey.
      if (si === null) cap = Math.max(cap, par + 2);
    }
    total += Math.min(strokes, cap);
  }
  return total;
}
