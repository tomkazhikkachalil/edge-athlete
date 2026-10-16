// ── Pool lengths (Oct 16 2026) — pure, ZERO imports ─────────────────────────
// A pool swim's length is a CHOICE (25 m, 50 m, 25 yd); lengths swum are
// the distance over it, rounded. 25 yd is exactly 22.86 m, so 1,500 m in a
// yard pool reads 66 lengths.

export const POOL_LENGTHS = ['25m', '50m', '25yd'] as const;
export type PoolLength = (typeof POOL_LENGTHS)[number];

export const POOL_LENGTH_M: Readonly<Record<PoolLength, number>> = { '25m': 25, '50m': 50, '25yd': 22.86 };
export const POOL_LENGTH_LABELS: Readonly<Record<PoolLength, string>> = { '25m': '25 m', '50m': '50 m', '25yd': '25 yd' };

export function isPoolLength(v: unknown): v is PoolLength {
  return typeof v === 'string' && (POOL_LENGTHS as readonly string[]).includes(v);
}

/** Lengths swum, or null without a distance or a pool. */
export function lengths(distanceM: number | null, pool: PoolLength | null | undefined): number | null {
  if (!pool || distanceM === null || !(distanceM > 0)) return null;
  return Math.round(distanceM / POOL_LENGTH_M[pool]);
}
