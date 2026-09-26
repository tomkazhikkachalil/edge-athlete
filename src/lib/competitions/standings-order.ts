// ── The read order of stored standings (gaps round, Sep 26 2026) ─────────────
// `competition_standings` has no position column: shared ranks come back
// from `.order('rank')` in whatever order Postgres likes, so two readers (or
// two reads) could list a tie differently. Every reader of a TABLE sorts
// through this one rule, which is the compute's own tiebreak
// (`bracket-draw.ts computeBracketStandings`: wins, then the entry id) — a
// fixture or leaderboard tie falls through to the entry id, their compute's
// last key too. Pure; never touches the ranks.

export interface OrderableStanding {
  entry_id: string;
  rank: number | null;
  stats?: unknown;
}

function wins(stats: unknown): number {
  const w = stats && typeof stats === 'object' ? (stats as { w?: unknown }).w : undefined;
  return typeof w === 'number' && Number.isFinite(w) ? w : 0;
}

export function orderStandingRows<T extends OrderableStanding>(rows: readonly T[]): T[] {
  const rankOf = (r: T) => (typeof r.rank === 'number' ? r.rank : Number.POSITIVE_INFINITY);
  return [...rows].sort(
    (a, b) =>
      rankOf(a) - rankOf(b) ||
      wins(b.stats) - wins(a.stats) ||
      (a.entry_id < b.entry_id ? -1 : a.entry_id > b.entry_id ? 1 : 0)
  );
}
