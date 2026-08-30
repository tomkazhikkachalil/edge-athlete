/**
 * Display helpers for the round detail/list surfaces.
 *
 * Stat columns (fairway_hit, green_in_regulation) are NULLABLE booleans and
 * the scorer only ever writes true/undefined — so null means "not tracked",
 * not "missed". Summaries must therefore use TRACKED counts as denominators:
 * "0/9 GIR" on a round where nobody tracked greens reads as a disastrous
 * round when the truth is "no data".
 */

/** hit/tracked summary over a stat column; tracked=0 means untracked. */
export function summarizeTrackedStat(
  values: Array<boolean | null | undefined>
): { hit: number; tracked: number } {
  let hit = 0;
  let tracked = 0;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    tracked += 1;
    if (v === true) hit += 1;
  }
  return { hit, tracked };
}

/** "3/5" when anything was tracked, em-dash when nothing was. */
export function trackedStatLabel(values: Array<boolean | null | undefined>): string {
  const { hit, tracked } = summarizeTrackedStat(values);
  return tracked === 0 ? '—' : `${hit}/${tracked}`;
}

/**
 * One vocabulary for hole counts: the CONFIGURED length names the round;
 * a partial round says how far it got. (The list card said "18 holes" while
 * the detail badge said "9 holes" for the same partial round.)
 */
export function holeCountLabel(played: number, configured: number): string {
  return `${holeCountValue(played, configured)} holes`;
}

/** The bare count, for a tile that already carries its own "Holes" label. */
export function holeCountValue(played: number, configured: number): string {
  // Nothing recorded — the configured length is all we know.
  if (played <= 0) return String(configured);
  // More holes than the round claims to be: the count is the honest number,
  // and "20 of 18" is nonsense. Reachable on the solo detail page, where hole
  // rows can outnumber golf_rounds.holes.
  if (played >= configured) return String(played);
  return `${played} of ${configured}`;
}

/**
 * How many holes were ACTUALLY played, from hole rows.
 *
 * The configured length is not an answer: `golf_scorecard_data.holes_played`
 * is written once at round creation and never recomputed, and a live round is
 * created before a single score exists — so it says 18 for a round that ended
 * after 13. Pair this with holeCountLabel, which falls back to the configured
 * length when nothing was recorded (a quick-entry round posts a gross score
 * and no hole rows at all; "0 holes" would be a lie in the other direction).
 *
 * DISTINCT hole numbers, because the group case unions rows across every
 * participant — the round's extent is what the group played, and a count that
 * differed per viewer would make one post read two ways.
 *
 * Filters on STROKES, not row presence: solo `golf_holes.strokes` is nullable,
 * so a row can exist for a hole nobody scored. (Shared `golf_hole_scores`
 * declares strokes NOT NULL CHECK > 0; the same filter is simply free there.)
 *
 * NOT deriveRecordedRound — that buckets to {9,18} for the write path, by
 * design, and can never return 13.
 */
export function playedHoleCount(
  holeRows: ReadonlyArray<{ hole_number?: number | null; strokes?: number | null }> | null | undefined
): number {
  if (!Array.isArray(holeRows)) return 0;
  const played = new Set<number>();
  for (const row of holeRows) {
    if (typeof row?.hole_number !== 'number') continue;
    if (typeof row?.strokes !== 'number' || row.strokes <= 0) continue;
    played.add(row.hole_number);
  }
  return played.size;
}
