/**
 * The leaderboard of a sport event round (Events program, phase 1) — pure,
 * the ONE computation. The leaderboard route and every card call this;
 * nothing stores a rank (Tom's spec, decision 6: leaderboards are computed,
 * never stored — the scorecard is the truth).
 *
 * Rules:
 *   * gross and to-par are sums over SCORED holes (a partial card's to-par is
 *     honest by construction); `thru` is the count of scored holes (equals
 *     the trigger-maintained holes_completed; robust to a back nine or a
 *     shotgun start).
 *   * net allocates handicap strokes per SCORED hole with strokesForHole over
 *     the played subset's re-ranked stroke indexes (rankStrokeIndexes —
 *     a nine at an 18-hole course allocates as 1..9); a scored hole whose
 *     stroke index is unknown makes net null with the reason. No index, no
 *     rating → net null with the reason. Net is never guessed.
 *   * ranks come from assignSharedRanks (src/lib/competitions/scoring.ts —
 *     "the one ranking rule"): equal keys share a rank; `formatRank` prints
 *     "T2". The sort key is net (stroke_net) or gross (stroke_gross), then
 *     to-par, then thru DESCENDING for ORDER only — a player further along
 *     on the same score lists first but shares the rank.
 *   * Players with no scored hole rank last, rank null.
 *   * An off-catalog round (no hole data) scores against par 4 over its
 *     hole range — the totals trigger's rule — and never has net.
 */
import { rankStrokeIndexes, strokesForHole } from '@/lib/golf/adjusted-gross';
import { assignSharedRanks } from '@/lib/competitions/scoring';
import { courseHandicapFor, playedPar } from './handicap';
import type { SportEventFormat, SportEventHoleDatum } from './types';
import { stablefordPoints } from '@/lib/golf/formats';
import { isNetFormat, isStablefordFormat } from './types';

export type NetReason = 'no_index' | 'no_rating' | 'no_stroke_index' | null;

export interface LeaderboardPlayer {
  participantId: string;
  profileId: string;
  name: string;
  handle: string | null;
  handicapIndex: number | null;
  /** The participant's flight (phase 2) — carried through to the row; the overall board segments by it. */
  flight?: string | null;
  holeScores: Array<{ hole_number: number; strokes: number | null }>;
  cardStatus: 'in_progress' | 'submitted' | 'final';
}

export interface LeaderboardInput {
  format: SportEventFormat;
  holes: 9 | 18;
  /** The first hole when there is no hole data (an off-catalog round); defaults to 1. */
  startingHole?: number;
  holeData: SportEventHoleDatum[] | null;
  courseRating: number | null;
  slopeRating: number | null;
  players: LeaderboardPlayer[];
}

export interface LeaderboardRow {
  participantId: string;
  profileId: string;
  name: string;
  handle: string | null;
  flight: string | null;
  rank: number | null;
  tied: boolean;
  rankLabel: string;
  thru: number;
  gross: number | null;
  toPar: number | null;
  net: number | null;
  netToPar: number | null;
  /** Leftovers: Stableford points over the scored holes (gross, and net through the same allocation) — computed for every format, the format picks the key. */
  points: number | null;
  netPoints: number | null;
  courseHandicap: number | null;
  netReason: NetReason;
  cardStatus: LeaderboardPlayer['cardStatus'];
}

/** "1", "T2", "—". */
export function formatRank(rank: number | null, tied: boolean): string {
  if (rank === null) return '—';
  return tied ? `T${rank}` : String(rank);
}

interface Scored {
  player: LeaderboardPlayer;
  thru: number;
  gross: number | null;
  toPar: number | null;
  net: number | null;
  netToPar: number | null;
  courseHandicap: number | null;
  netReason: NetReason;
  points: number | null;
  netPoints: number | null;
}

function scorePlayer(p: LeaderboardPlayer, input: LeaderboardInput, parByHole: Map<number, number>, siByHole: Map<number, number | null>): Scored {
  const scored = p.holeScores.filter(h => typeof h.strokes === 'number' && h.strokes > 0 && parByHole.has(h.hole_number));
  const thru = scored.length;
  if (thru === 0) return { player: p, thru: 0, gross: null, toPar: null, net: null, netToPar: null, points: null, netPoints: null, courseHandicap: null, netReason: null };
  let gross = 0;
  let toPar = 0;
  let points = 0;
  for (const h of scored) {
    gross += h.strokes as number;
    toPar += (h.strokes as number) - (parByHole.get(h.hole_number) as number);
    points += stablefordPoints(h.strokes as number, parByHole.get(h.hole_number) as number);
  }
  const ch = courseHandicapFor({ handicap_index: p.handicapIndex }, {
    holes: input.holes,
    course_rating: input.courseRating,
    slope_rating: input.slopeRating,
    par: playedPar(input.holeData),
  });
  let net: number | null = null;
  let netToPar: number | null = null;
  let netPoints: number | null = null;
  let netReason: NetReason = null;
  if (p.handicapIndex === null) netReason = 'no_index';
  else if (ch === null) netReason = 'no_rating';
  else {
    // Allocate over the round's played holes (re-ranked), then sum over the scored ones.
    const holesInOrder = (input.holeData ?? []).map(h => h.hole);
    const ranked = rankStrokeIndexes(holesInOrder.map(n => siByHole.get(n) ?? null));
    const rankByHole = new Map<number, number | null>();
    holesInOrder.forEach((n, i) => rankByHole.set(n, ranked[i]));
    let allocated = 0;
    let netPts = 0;
    for (const h of scored) {
      const si = rankByHole.get(h.hole_number);
      if (typeof si !== 'number') { netReason = 'no_stroke_index'; break; }
      const given = strokesForHole(ch, si);
      allocated += given;
      // The net points use the SAME allocation as the net strokes — never re-derived.
      netPts += stablefordPoints((h.strokes as number) - given, parByHole.get(h.hole_number) as number);
    }
    if (netReason === null) {
      net = gross - allocated;
      netToPar = toPar - allocated;
      netPoints = netPts;
    }
  }
  return { player: p, thru, gross, toPar, net, netToPar, points, netPoints, courseHandicap: ch, netReason };
}

/** The score tuple every ranking reads (a round row, or a fold of rounds). */
export interface ScoreTuple {
  gross: number | null;
  toPar: number | null;
  net: number | null;
  netToPar: number | null;
  points: number | null;
  netPoints: number | null;
}

/** THE ONE ranking rule for a format: the key and its direction, the order-only second key, the shared-rank key. Stroke play ranks on the
 *  strokes with the to-par in the shared key (byte-identical to phase 2); Stableford ranks on the POINTS descending, the strokes ascending
 *  order-only (equal points share a rank). */
export interface RankingKeys {
  net: boolean;
  stableford: boolean;
  direction: 'asc' | 'desc';
  key(t: ScoreTuple): number | null;
  second(t: ScoreTuple): number | null;
  compare(a: ScoreTuple, b: ScoreTuple): number;
  rankKey(t: ScoreTuple): string;
}

export function rankingKeys(format: SportEventFormat): RankingKeys {
  const stableford = isStablefordFormat(format);
  const net = isNetFormat(format);
  const key = (t: ScoreTuple) => (stableford ? (net ? t.netPoints : t.points) : net ? t.net : t.gross);
  const second = (t: ScoreTuple) => (stableford ? (net ? t.net : t.gross) : net ? t.netToPar : t.toPar);
  const direction: 'asc' | 'desc' = stableford ? 'desc' : 'asc';
  const sign = direction === 'asc' ? 1 : -1;
  return {
    net,
    stableford,
    direction,
    key,
    second,
    compare: (a, b) => {
      const ka = key(a) as number;
      const kb = key(b) as number;
      if (ka !== kb) return sign * (ka - kb);
      const sa = second(a) ?? Number.POSITIVE_INFINITY;
      const sb = second(b) ?? Number.POSITIVE_INFINITY;
      return sa - sb;
    },
    rankKey: t => (stableford ? `${key(t)}` : `${key(t)}|${second(t)}`),
  };
}

/** "31" · "—". */
export function formatPoints(points: number | null): string {
  return points === null ? '—' : String(points);
}

export function computeLeaderboard(input: LeaderboardInput): LeaderboardRow[] {
  const parByHole = new Map<number, number>();
  const siByHole = new Map<number, number | null>();
  for (const h of input.holeData ?? []) {
    parByHole.set(h.hole, h.par);
    siByHole.set(h.hole, typeof h.handicap === 'number' && h.handicap >= 1 && h.handicap <= 18 ? h.handicap : null);
  }
  if (parByHole.size === 0) {
    // An off-catalog round has no hole data: the totals trigger scores it
    // against par 4, and so does the board. Holes run from the starting hole.
    const first = input.startingHole ?? 1;
    for (let n = first; n < first + input.holes && n <= 18; n++) {
      parByHole.set(n, 4);
      siByHole.set(n, null);
    }
  }
  const scored = input.players.map(p => scorePlayer(p, input, parByHole, siByHole));
  const keys = rankingKeys(input.format);
  const keyOf = (s: Scored): number | null => keys.key(s);
  const ranked = scored.filter(s => s.thru > 0 && keyOf(s) !== null);
  const unranked = scored.filter(s => !(s.thru > 0 && keyOf(s) !== null));
  ranked.sort((a, b) => {
    const c = keys.compare(a, b);
    if (c !== 0) return c;
    if (a.thru !== b.thru) return b.thru - a.thru;
    return a.player.name.localeCompare(b.player.name);
  });
  const ranks = assignSharedRanks(ranked.length, i => keys.rankKey(ranked[i]));
  const rows: LeaderboardRow[] = ranked.map((s, i) => {
    const tied = ranks.filter(r => r === ranks[i]).length > 1;
    return toRow(s, ranks[i], tied);
  });
  unranked.sort((a, b) => b.thru - a.thru || a.player.name.localeCompare(b.player.name));
  for (const s of unranked) rows.push(toRow(s, null, false));
  return rows;
}

function toRow(s: Scored, rank: number | null, tied: boolean): LeaderboardRow {
  return {
    participantId: s.player.participantId,
    profileId: s.player.profileId,
    name: s.player.name,
    handle: s.player.handle,
    flight: s.player.flight ?? null,
    rank,
    tied,
    rankLabel: formatRank(rank, tied),
    thru: s.thru,
    gross: s.gross,
    toPar: s.toPar,
    net: s.net,
    netToPar: s.netToPar,
    points: s.points,
    netPoints: s.netPoints,
    courseHandicap: s.courseHandicap,
    netReason: s.netReason,
    cardStatus: s.player.cardStatus,
  };
}

/** "F" when the card is done, "—" when nothing scored, else the hole count. */
export function formatThru(thru: number, holes: number): string {
  if (thru <= 0) return '—';
  return thru >= holes ? 'F' : String(thru);
}

/** "E", "+3", "−2". */
export function formatToPar(toPar: number | null): string {
  if (toPar === null) return '—';
  if (toPar === 0) return 'E';
  return toPar > 0 ? `+${toPar}` : `−${Math.abs(toPar)}`;
}
