// ── Course stats from members' public rounds (phase 6e S3) ────────────────
// Tom's principle 2 applied to a golf club's course page: members post
// rounds anyway, so the page fills itself — scoring average by tee, the
// course record, the hardest holes, the recent low rounds. No admin
// retyping, no new tables. Pure and node-tested; the reader in
// org-sites/course-stats.ts does the I/O.
//
// THE TWO-KEY RULE (the feed's, src/app/api/posts/route.ts): a round is
// public only when it has a PUBLIC POST and its athlete's PROFILE is
// public. A "log only" round (no post) never appears; a private profile
// never appears; supervised athletes are omitted upstream (the crawlable-
// surface rule). Names arrive already masked (publicDisplayName).
//
// Nine holes is normal: every bucket keys on (holes, tee) so a 9-hole 38
// and an 18-hole 76 never compete. Untracked strokes (null) are not
// misses — a hole counts only when its strokes were recorded.

export interface CourseStatsRound {
  id: string;
  profileId: string;
  /** YYYY-MM-DD (a DATE column — compared as a string). */
  date: string;
  tee: string | null;
  holes: number;
  gross: number;
  createdAt: string;
}

export interface CourseStatsHole {
  roundId: string;
  hole: number;
  par: number | null;
  strokes: number | null;
}

export interface TeeBucket {
  tee: string;
  holes: number;
  rounds: number;
  avgGross: number;
  best: { gross: number; date: string; name: string };
}

export interface CourseRecord {
  holes: number;
  tee: string;
  gross: number;
  date: string;
  name: string;
}

export interface HardestHole {
  hole: number;
  par: number | null;
  avgOverPar: number;
  tracked: number;
}

export interface RecentRound {
  name: string;
  date: string;
  gross: number;
  tee: string | null;
  holes: number;
}

export interface CourseStats {
  roundsPosted: number;
  byTee: TeeBucket[];
  courseRecord: CourseRecord[];
  hardestHoles: HardestHole[];
  recentRounds: RecentRound[];
}

export const UNKNOWN_TEE = 'unknown';

/** The two-key filter, pure. */
export function selectPublicRounds<T extends { id: string; profileId: string }>(
  rounds: T[],
  publicPostRoundIds: Set<string>,
  publicProfileIds: Set<string>
): T[] {
  return rounds.filter(r => publicPostRoundIds.has(r.id) && publicProfileIds.has(r.profileId));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function byDateDesc<T extends { date: string; createdAt: string }>(a: T, b: T): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

export function buildCourseStats(input: {
  rounds: CourseStatsRound[];
  holes: CourseStatsHole[];
  nameById: Map<string, string>;
  /** Par per hole from the catalog, for holes rows without one. */
  parByHole?: Map<number, number>;
  minTracked?: number;
  recent?: number;
}): CourseStats {
  const minTracked = input.minTracked ?? 5;
  const recentN = input.recent ?? 5;
  const name = (profileId: string) => input.nameById.get(profileId) ?? 'Member';
  const rounds = input.rounds.filter(r => Number.isFinite(r.gross) && r.gross > 0 && (r.holes === 9 || r.holes === 18));

  // (holes, tee) buckets — nine and eighteen never compete.
  const buckets = new Map<string, CourseStatsRound[]>();
  for (const r of rounds) {
    const key = `${r.holes}:${r.tee ?? UNKNOWN_TEE}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(r);
  }
  const byTee: TeeBucket[] = [];
  for (const [, rs] of buckets) {
    // Best = lowest gross; ties → the EARLIEST date (the record was set first).
    const best = [...rs].sort((a, b) => a.gross - b.gross || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))[0];
    byTee.push({
      tee: rs[0].tee ?? UNKNOWN_TEE,
      holes: rs[0].holes,
      rounds: rs.length,
      avgGross: round1(rs.reduce((s, r) => s + r.gross, 0) / rs.length),
      best: { gross: best.gross, date: best.date, name: name(best.profileId) },
    });
  }
  byTee.sort((a, b) => b.holes - a.holes || b.rounds - a.rounds || a.tee.localeCompare(b.tee));

  // Course record: the lowest gross per (holes, tee) — the byTee bests,
  // eighteen first, then by gross.
  const courseRecord: CourseRecord[] = byTee
    .map(b => ({ holes: b.holes, tee: b.tee, gross: b.best.gross, date: b.best.date, name: b.best.name }))
    .sort((a, b) => b.holes - a.holes || a.gross - b.gross);

  // Hardest holes: mean strokes over par across TRACKED holes only.
  const roundIds = new Set(rounds.map(r => r.id));
  const perHole = new Map<number, { over: number; n: number; par: number | null }>();
  for (const h of input.holes) {
    if (!roundIds.has(h.roundId)) continue;
    if (typeof h.strokes !== 'number' || h.strokes <= 0) continue; // untracked ≠ missed
    const par = h.par ?? input.parByHole?.get(h.hole) ?? null;
    if (par === null) continue;
    const cur = perHole.get(h.hole) ?? { over: 0, n: 0, par };
    cur.over += h.strokes - par;
    cur.n += 1;
    perHole.set(h.hole, cur);
  }
  const hardestHoles: HardestHole[] = [...perHole.entries()]
    .filter(([, v]) => v.n >= minTracked)
    .map(([hole, v]) => ({ hole, par: v.par, avgOverPar: round1(v.over / v.n), tracked: v.n }))
    .sort((a, b) => b.avgOverPar - a.avgOverPar || a.hole - b.hole)
    .slice(0, 3);

  const recentRounds: RecentRound[] = [...rounds]
    .sort(byDateDesc)
    .slice(0, recentN)
    .map(r => ({ name: name(r.profileId), date: r.date, gross: r.gross, tee: r.tee, holes: r.holes }));

  return { roundsPosted: rounds.length, byTee, courseRecord, hardestHoles, recentRounds };
}
