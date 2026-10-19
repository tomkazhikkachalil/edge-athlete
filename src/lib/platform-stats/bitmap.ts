/**
 * The seen bitmap (migration 267), mirrored in TypeScript so the SQL's math
 * is pinned by a test that needs no database. Pure, ZERO imports, and no
 * BigInt (the build targets ES2017): the mask is modelled as the SET of bit
 * offsets that are on.
 *
 * In the row, `days_mask` bit i (LSB = 0) means "seen on last_day - i"; bit 0
 * is always set. A bump by `delta` days shifts every offset up by `delta`,
 * drops the ones that pass 63, and sets offset 0; at 64 or more days away the
 * history is gone (Postgres masks int8 shifts at 64 — `1 << 64 = 1` — so the
 * SQL caps the shift explicitly and so does this). "Seen on day X" reads
 * offset (last_day - X), valid for 0 ≤ last_day - X ≤ 63.
 */
export const MASK_BITS = 63;

/** The offsets that are on, ascending; a fresh row is [0]. */
export type Mask = readonly number[];

export const FRESH_MASK: Mask = [0];

/** The mask after a bump from `lastDay` to `newDay` (dates as day numbers). Same or past day: unchanged. */
export function bumpMask(mask: Mask, lastDay: number, newDay: number): Mask {
  const delta = newDay - lastDay;
  if (delta <= 0) return mask;
  if (delta >= 64) return FRESH_MASK;
  const shifted = mask.map(o => o + delta).filter(o => o <= MASK_BITS);
  return [0, ...shifted.filter(o => o !== 0)].sort((a, b) => a - b);
}

/** Whether the account was seen on `day`, given its row. */
export function seenOn(mask: Mask, lastDay: number, day: number): boolean {
  const k = lastDay - day;
  if (k < 0 || k > MASK_BITS) return false;
  return mask.includes(k);
}

/** The integer the row would hold, for masks whose offsets stay under 53 bits (tests and the e2e read it back). */
export function maskValue(mask: Mask): number {
  return mask.reduce((sum, o) => (o < 53 ? sum + 2 ** o : sum), 0);
}

/** Strict Dn retention: of the accounts whose first day is `cohortDay`, how many were seen ON `cohortDay + n`. */
export function retained(rows: readonly { firstDay: number; lastDay: number; mask: Mask }[], cohortDay: number, n: number): { size: number; retained: number } {
  const day = cohortDay + n;
  let size = 0;
  let kept = 0;
  for (const r of rows) {
    if (r.firstDay !== cohortDay) continue;
    size++;
    if (seenOn(r.mask, r.lastDay, day)) kept++;
  }
  return { size, retained: kept };
}
