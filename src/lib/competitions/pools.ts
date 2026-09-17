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

// ── PR 2: the round-robin per pool, the seeding into a bracket ──────────────

export interface Pairing {
  round: number;
  home: string;
  away: string;
}

/** The circle method: n−1 rounds of ⌊n/2⌋ games (an odd field sits one out per round), every pair once; home / away alternate by
 *  round and seat so no entry is always at home; `legs: 2` mirrors every game with the sides swapped in the rounds after. */
export function roundRobinPairings(entryIds: ReadonlyArray<string>, legs: 1 | 2): Pairing[] {
  const ids: Array<string | null> = [...entryIds];
  if (ids.length < 2) return [];
  if (ids.length % 2 === 1) ids.push(null);
  const n = ids.length;
  const rounds = n - 1;
  const out: Pairing[] = [];
  const ring = ids.slice(1);
  // Home / away: the side with fewer home games so far takes home (ties to the first seat) — within one of even for every field.
  const homes = new Map<string, number>();
  for (let r = 0; r < rounds; r++) {
    const order = [ids[0], ...ring];
    for (let i = 0; i < n / 2; i++) {
      const x = order[i];
      const y = order[n - 1 - i];
      if (x === null || y === null) continue;
      const home = (homes.get(x) ?? 0) > (homes.get(y) ?? 0) ? y : x;
      const away = home === x ? y : x;
      homes.set(home, (homes.get(home) ?? 0) + 1);
      out.push({ round: r + 1, home, away });
    }
    ring.unshift(ring.pop() as string | null);
  }
  if (legs === 2) {
    const first = [...out];
    for (const g of first) out.push({ round: g.round + rounds, home: g.away, away: g.home });
  }
  return out;
}

export interface PoolGame {
  pool: PoolLetter;
  round: number;
  label: string;
  home: string;
  away: string;
}

export interface PoolGameReport {
  pools: Array<{ pool: PoolLetter; entries: number; games: number; skipped: number }>;
  games: number;
  skipped: number;
}

/** The games to mint: the round-robin per pool, minus the pairs already played or scheduled — a single leg dedupes the UNORDERED pair
 *  (a pair meets once), two legs the ORDERED pair (once at home, once away). `existing` holds `${home}:${away}` of every contest. */
export function poolGamePlan(pools: ReadonlyArray<PoolGroup>, legs: 1 | 2, existing: ReadonlySet<string>): { games: PoolGame[]; report: PoolGameReport } {
  const games: PoolGame[] = [];
  const report: PoolGameReport = { pools: [], games: 0, skipped: 0 };
  for (const p of pools) {
    let skipped = 0;
    let made = 0;
    for (const g of roundRobinPairings(p.entryIds, legs)) {
      const played = legs === 1 ? existing.has(`${g.home}:${g.away}`) || existing.has(`${g.away}:${g.home}`) : existing.has(`${g.home}:${g.away}`);
      if (played) { skipped += 1; continue; }
      games.push({ pool: p.pool, round: g.round, label: poolRoundLabel(p.pool, g.round), home: g.home, away: g.away });
      made += 1;
    }
    report.pools.push({ pool: p.pool, entries: p.entryIds.length, games: made, skipped });
    report.games += made;
    report.skipped += skipped;
  }
  return { games, report };
}

/** The seeds a bracket takes from the pools, in the cross order A1, B1, C1 …, then A2, B2 … (a short pool contributes what it has).
 *  A pool's `entryIds` is its TABLE ORDER — ties at the nth place are not widened; the table's deterministic order decides. */
export function crossPoolSeeds(poolsRanked: ReadonlyArray<{ pool: PoolLetter; entryIds: string[] }>, perPool: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < perPool; i++) for (const p of poolsRanked) if (p.entryIds[i]) out.push(p.entryIds[i]);
  return out;
}

export type PoolSeedRefusal = 'not_fixture' | 'no_pools' | 'target_not_bracket' | 'target_drawn' | 'target_closed' | 'sport_mismatch' | 'entrant_mismatch' | 'not_enough' | 'too_many';

export const POOL_SEED_REFUSAL_COPY: Readonly<Record<PoolSeedRefusal, string>> = {
  not_fixture: 'Pools belong to a fixture competition.',
  no_pools: 'No entry has a pool yet — set the pool letters first.',
  target_not_bracket: 'The seeds go to a bracket competition.',
  target_drawn: 'That bracket is already drawn — regenerate it without a draw first.',
  target_closed: 'That bracket is closed.',
  sport_mismatch: 'The bracket must be in the same sport.',
  entrant_mismatch: 'The bracket must take the same kind of entrant.',
  not_enough: 'Fewer than two seeds — take more from each pool.',
  too_many: 'A bracket takes at most 64 seeds.',
};

export function poolSeedRefusal(
  source: { format: string; sport_key: string; entrant_type: string },
  target: { format: string; sport_key: string; entrant_type: string; status: string },
  facts: { pools: number; drawn: boolean; seeds: number }
): PoolSeedRefusal | null {
  if (source.format !== 'fixture') return 'not_fixture';
  if (facts.pools === 0) return 'no_pools';
  if (target.format !== 'bracket') return 'target_not_bracket';
  if (target.status === 'completed' || target.status === 'archived') return 'target_closed';
  if (facts.drawn) return 'target_drawn';
  if (target.sport_key !== source.sport_key) return 'sport_mismatch';
  if (target.entrant_type !== source.entrant_type) return 'entrant_mismatch';
  if (facts.seeds < 2) return 'not_enough';
  if (facts.seeds > 64) return 'too_many';
  return null;
}
