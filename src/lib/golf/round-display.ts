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
  if (played > 0 && played !== configured) return `${played} of ${configured} holes`;
  return `${configured} holes`;
}
