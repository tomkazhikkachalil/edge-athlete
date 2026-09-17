/**
 * Pools on a fixture competition (Events + formats leftovers, PR 1 + 2) —
 * pure. A pool is a LETTER on the entry (`competition_entries.pool`, on the
 * table since 151, unwritten until now). The standings stay ONE row per
 * entry (the prune keeps only returned rows — trap 14): a pooled entry is
 * ranked WITHIN its pool and carries `stats.pool` = the 1-based letter
 * index (`StandingRow.stats` is numeric); the unpooled entries form one
 * more flat table. A contest whose sides are not both in one pool counts
 * in NEITHER (scoring.ts's withdrawn-entry rule — the row is not in the
 * pool's table). PR 2 adds the round-robin per pool and the cross-pool
 * seeding into a bracket.
 */
import { computeFixtureStandings, type FixtureContestInput, type FixtureScoringRule, type StandingRow } from './scoring';

export const POOL_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export type PoolLetter = (typeof POOL_LETTERS)[number];

export const isPoolLetter = (v: unknown): v is PoolLetter => typeof v === 'string' && (POOL_LETTERS as readonly string[]).includes(v);
/** A → 1 … H → 8 (the number a standings row carries). */
export const poolIndex = (p: PoolLetter): number => POOL_LETTERS.indexOf(p) + 1;
export const poolLetter = (i: number | null | undefined): PoolLetter | null => (typeof i === 'number' && Number.isInteger(i) && i >= 1 && i <= POOL_LETTERS.length ? POOL_LETTERS[i - 1] : null);

export interface PoolGroup {
  pool: PoolLetter;
  entryIds: string[];
}

/** The pools present among the entries (approved only when a status is given), in letter order, each with its entries in input order. */
export function poolsOf(entries: ReadonlyArray<{ id: string; pool: string | null; status?: string }>): PoolGroup[] {
  const by = new Map<PoolLetter, string[]>();
  for (const e of entries) {
    if (e.status !== undefined && e.status !== 'approved') continue;
    if (!isPoolLetter(e.pool)) continue;
    if (!by.has(e.pool)) by.set(e.pool, []);
    by.get(e.pool)!.push(e.id);
  }
  return POOL_LETTERS.filter(p => by.has(p)).map(pool => ({ pool, entryIds: by.get(pool)! }));
}

/** The pooled table: per pool the flat engine over that pool's entries (rank WITHIN the pool, `stats.pool`), then the unpooled entries as one flat table. ONE row per entry, always. */
export function computePooledFixtureStandings(entries: ReadonlyArray<{ id: string; pool: string | null }>, contests: FixtureContestInput[], rule: FixtureScoringRule): StandingRow[] {
  const pools = poolsOf(entries);
  const pooled = new Set(pools.flatMap(p => p.entryIds));
  const out: StandingRow[] = [];
  for (const p of pools) {
    for (const row of computeFixtureStandings(p.entryIds, contests, rule)) out.push({ ...row, stats: { ...row.stats, pool: poolIndex(p.pool) } });
  }
  const rest = entries.map(e => e.id).filter(id => !pooled.has(id));
  if (rest.length > 0) out.push(...computeFixtureStandings(rest, contests, rule));
  return out;
}

export interface PoolRowGroup<R> {
  /** null = the unpooled table (no caption). */
  pool: PoolLetter | null;
  rows: R[];
}

/** The renderers' grouping: rows by `stats.pool` in letter order, the unpooled rows last; without pools, one group with no caption. Server-safe. */
export function groupRowsByPool<R extends { stats: Record<string, number> }>(rows: ReadonlyArray<R>, pooled: boolean): PoolRowGroup<R>[] {
  if (!pooled) return [{ pool: null, rows: [...rows] }];
  const by = new Map<PoolLetter | null, R[]>();
  for (const r of rows) {
    const pool = poolLetter(r.stats.pool);
    if (!by.has(pool)) by.set(pool, []);
    by.get(pool)!.push(r);
  }
  const out: PoolRowGroup<R>[] = POOL_LETTERS.filter(p => by.has(p)).map(pool => ({ pool, rows: by.get(pool)! }));
  if (by.has(null)) out.push({ pool: null, rows: by.get(null)! });
  return out;
}

/** The label of a pool's round-robin round (PR 2). */
export const poolRoundLabel = (pool: PoolLetter, round: number): string => `Pool ${pool} · Round ${round}`;
