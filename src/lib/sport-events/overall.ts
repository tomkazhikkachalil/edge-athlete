/**
 * The OVERALL leaderboard of a tournament (Events program, phase 2) — pure,
 * a fold over the rounds' boards. Each round's rows come from
 * computeLeaderboard (the one computation); this file only sums, ranks and
 * compares — nothing here re-reads a hole. Nothing is stored.
 *
 * The rules (Tom, Sep 16 2026 — what the best tournament apps show):
 *   * the key is the format's: net (stroke_net) or gross, SUMMED over every
 *     minted round's scored holes — the live round's partial total counts,
 *     so the Total column moves during play like the PGA board's;
 *   * a player who MISSED a completed round (never scored a hole in it)
 *     ranks below every full-field player regardless of total (no DNF
 *     fill-in — a 9-hole zero must never "win"); missing more rounds ranks
 *     lower still;
 *   * ties share a rank (assignSharedRanks, THE one ranking rule) and print
 *     "T2"; the order-only tiebreak is today's thru DESC (further along
 *     lists first), then name;
 *   * a player with no scored hole in any round is unranked, last, "—";
 *   * net needs net in EVERY played round — otherwise null with the first
 *     reason (never a mix of net and gross rounds);
 *   * `today` is the live round's cell (null when no round is live);
 *   * `movement` is the change from the standing after the previous
 *     completed round (the same fold over the rounds before `current`);
 *     null before round 2;
 *   * a flight filter ranks WITHIN the flight; `flights` lists the whole
 *     field's flight labels either way;
 *   * the cut (207 `format_config.cut`): once the round it follows has
 *     completed, the standing through that round decides (cut.ts) — the
 *     missed-cut set ranks below the line (`madeCut` false; `cutLine`),
 *     never "missing" the rounds it was not in; null = no cut or not yet
 *     decided.
 */
import { assignSharedRanks } from '@/lib/competitions/scoring';
import { applyCut, cutDecided, type CutLine } from './cut';
import { formatRank, type LeaderboardRow, type NetReason, rankingKeys, type RankingKeys, type ScoreTuple } from './leaderboard';
import type { SportEventFormat, SportEventRoundStatus } from './types';

export interface RoundBoardInput {
  roundId: string;
  sequence: number;
  status: SportEventRoundStatus;
  holes: number;
  rows: LeaderboardRow[];
}

export type { CutRule } from './types';

export interface OverallOptions {
  /** The organizer's cut (207); applied once the round it follows has completed. */
  cut?: import('./types').CutRule | null;
  /** Rank within this flight only. */
  flight?: string | null;
  /** The round the board is "as of": the live round's sequence, else the last completed. Derived when omitted. */
  current?: number | null;
}

export interface OverallRoundCell {
  roundId: string;
  sequence: number;
  status: SportEventRoundStatus;
  holes: number;
  gross: number | null;
  toPar: number | null;
  net: number | null;
  netToPar: number | null;
  points: number | null;
  netPoints: number | null;
  thru: number;
  cardStatus: LeaderboardRow['cardStatus'];
  /** At least one hole scored in this round. */
  played: boolean;
}

export interface OverallRow {
  participantId: string;
  profileId: string;
  name: string;
  handle: string | null;
  flight: string | null;
  /** One cell per minted round, sequence order. */
  rounds: OverallRoundCell[];
  total: number | null;
  totalToPar: number | null;
  net: number | null;
  netToPar: number | null;
  points: number | null;
  netPoints: number | null;
  netReason: NetReason;
  roundsPlayed: number;
  /** The sequences of COMPLETED rounds this player never scored in. */
  missedRounds: number[];
  today: { sequence: number; toPar: number | null; netToPar: number | null; points: number | null; netPoints: number | null; thru: number; holes: number } | null;
  rank: number | null;
  tied: boolean;
  rankLabel: string;
  prevRank: number | null;
  /** prevRank − rank: positive = moved up. Null before round 2 or when unranked either time. */
  movement: number | null;
  madeCut: boolean | null;
}

export interface OverallBoard {
  rows: OverallRow[];
  /** The sequence the board is as of (the live round, else the last completed), null with nothing minted. */
  current: number | null;
  /** The sequences of rounds with at least one scored hole. */
  scoredRounds: number[];
  /** Every flight label in the whole field, sorted. */
  flights: string[];
  cutLine: CutLine | null;
}

const MINTED: ReadonlySet<SportEventRoundStatus> = new Set(['live', 'completed']);

function currentSequence(rounds: RoundBoardInput[]): number | null {
  const live = rounds.find(r => r.status === 'live');
  if (live) return live.sequence;
  let last: number | null = null;
  for (const r of rounds) if (r.status === 'completed' && (last === null || r.sequence > last)) last = r.sequence;
  return last;
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function flightsOf(rows: ReadonlyArray<{ flight: string | null }>): string[] {
  return [...new Set(rows.map(r => r.flight).filter((f): f is string => typeof f === 'string' && f.length > 0))].sort(naturalCompare);
}

interface Folded {
  row: Omit<OverallRow, 'rank' | 'tied' | 'rankLabel' | 'prevRank' | 'movement'>;
  tuple: ScoreTuple;
  todayThru: number;
}

function fold(rounds: RoundBoardInput[], liveSequence: number | null): Folded[] {
  const byPlayer = new Map<string, { base: LeaderboardRow; cells: Map<number, LeaderboardRow> }>();
  for (const r of rounds) {
    for (const row of r.rows) {
      const entry = byPlayer.get(row.participantId) ?? { base: row, cells: new Map<number, LeaderboardRow>() };
      entry.base = row; // the latest round's name / flight wins
      entry.cells.set(r.sequence, row);
      byPlayer.set(row.participantId, entry);
    }
  }
  const out: Folded[] = [];
  for (const [participantId, entry] of byPlayer) {
    const cells: OverallRoundCell[] = rounds.map(r => {
      const c = entry.cells.get(r.sequence);
      const played = !!c && c.thru > 0;
      return {
        roundId: r.roundId,
        sequence: r.sequence,
        status: r.status,
        holes: r.holes,
        gross: played ? c!.gross : null,
        toPar: played ? c!.toPar : null,
        net: played ? c!.net : null,
        netToPar: played ? c!.netToPar : null,
        points: played ? c!.points : null,
        netPoints: played ? c!.netPoints : null,
        thru: c?.thru ?? 0,
        cardStatus: c?.cardStatus ?? 'in_progress',
        played,
      };
    });
    const played = cells.filter(c => c.played);
    let total: number | null = null;
    let totalToPar: number | null = null;
    let net: number | null = null;
    let netToPar: number | null = null;
    let points: number | null = null;
    let netPoints: number | null = null;
    let netReason: NetReason = null;
    if (played.length > 0) {
      total = played.reduce((sum, c) => sum + (c.gross as number), 0);
      totalToPar = played.reduce((sum, c) => sum + (c.toPar as number), 0);
      points = played.reduce((sum, c) => sum + (c.points ?? 0), 0);
      const missingNet = played.find(c => c.net === null);
      if (missingNet) {
        netReason = entry.cells.get(missingNet.sequence)?.netReason ?? 'no_index';
      } else {
        net = played.reduce((sum, c) => sum + (c.net as number), 0);
        netToPar = played.reduce((sum, c) => sum + (c.netToPar as number), 0);
        netPoints = played.reduce((sum, c) => sum + (c.netPoints ?? 0), 0);
      }
    }
    const missedRounds = cells.filter(c => c.status === 'completed' && !c.played).map(c => c.sequence);
    const todayCell = liveSequence === null ? null : cells.find(c => c.sequence === liveSequence) ?? null;
    const today = todayCell ? { sequence: todayCell.sequence, toPar: todayCell.toPar, netToPar: todayCell.netToPar, points: todayCell.points, netPoints: todayCell.netPoints, thru: todayCell.thru, holes: todayCell.holes } : null;
    out.push({
      row: {
        participantId,
        profileId: entry.base.profileId,
        name: entry.base.name,
        handle: entry.base.handle,
        flight: entry.base.flight ?? null,
        rounds: cells,
        total,
        totalToPar,
        net,
        netToPar,
        points,
        netPoints,
        netReason,
        roundsPlayed: played.length,
        missedRounds,
        today,
        madeCut: null,
      },
      tuple: { gross: total, toPar: totalToPar, net, netToPar, points, netPoints },
      todayThru: todayCell?.thru ?? 0,
    });
  }
  return out;
}

/** Rank a folded field: the sort tuple, shared ranks, unranked last. Returns rows in board order. */
function rank(folded: Folded[], keys: RankingKeys): OverallRow[] {
  const ranked = folded.filter(f => f.row.roundsPlayed > 0 && keys.key(f.tuple) !== null);
  const unranked = folded.filter(f => !(f.row.roundsPlayed > 0 && keys.key(f.tuple) !== null));
  const missedKey = (f: Folded) => f.row.missedRounds.length;
  const cutKey = (f: Folded) => (f.row.madeCut === false ? 1 : 0);
  ranked.sort((a, b) => {
    if (missedKey(a) !== missedKey(b)) return missedKey(a) - missedKey(b);
    if (cutKey(a) !== cutKey(b)) return cutKey(a) - cutKey(b);
    const c = keys.compare(a.tuple, b.tuple);
    if (c !== 0) return c;
    if (a.todayThru !== b.todayThru) return b.todayThru - a.todayThru;
    return a.row.name.localeCompare(b.row.name);
  });
  const ranks = assignSharedRanks(ranked.length, i => `${missedKey(ranked[i])}|${cutKey(ranked[i])}|${keys.rankKey(ranked[i].tuple)}`);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const rows: OverallRow[] = ranked.map((f, i) => {
    const tied = (counts.get(ranks[i]) ?? 0) > 1;
    return { ...f.row, rank: ranks[i], tied, rankLabel: formatRank(ranks[i], tied), prevRank: null, movement: null };
  });
  unranked.sort((a, b) => b.todayThru - a.todayThru || a.row.name.localeCompare(b.row.name));
  for (const f of unranked) rows.push({ ...f.row, rank: null, tied: false, rankLabel: formatRank(null, false), prevRank: null, movement: null });
  return rows;
}

export function computeOverallLeaderboard(input: RoundBoardInput[], format: SportEventFormat, options: OverallOptions = {}): OverallBoard {
  const rounds = [...input].filter(r => MINTED.has(r.status)).sort((a, b) => a.sequence - b.sequence);
  const current = options.current ?? currentSequence(rounds);
  const liveSequence = rounds.find(r => r.status === 'live')?.sequence ?? null;
  const keys = rankingKeys(format);
  const allFolded = fold(rounds, liveSequence);

  // The cut: the standing THROUGH round K decides; a player who missed it
  // ranks below the line and is never "missing" the rounds they were not
  // in. Decided only once round K has completed (cut.ts cutDecided).
  let cutLine: CutLine | null = null;
  const cut = options.cut ?? null;
  if (cut && cutDecided(cut, rounds)) {
    const throughK = rank(fold(rounds.filter(r => r.sequence <= cut.after_round), null), keys);
    const tupleOf = (r: OverallRow): ScoreTuple => ({ gross: r.total, toPar: r.totalToPar, net: r.net, netToPar: r.netToPar, points: r.points, netPoints: r.netPoints });
    const decided = applyCut(throughK.map(r => ({ participantId: r.participantId, rank: r.rank, keyToPar: keys.stableford ? null : keys.second(tupleOf(r)), key: keys.key(tupleOf(r)) })), cut, keys.direction);
    cutLine = decided.line;
    for (const f of allFolded) {
      f.row.madeCut = decided.made.has(f.row.participantId);
      if (!f.row.madeCut) f.row.missedRounds = f.row.missedRounds.filter(seq => seq <= cut.after_round);
    }
  }

  const flights = flightsOf(allFolded.map(f => f.row));
  const folded = options.flight ? allFolded.filter(f => f.row.flight === options.flight) : allFolded;
  const rows = rank(folded, keys);

  // Movement: the same fold over the rounds BEFORE the current one, when at least one of them is completed.
  const prior = current === null ? [] : rounds.filter(r => r.sequence < current && r.status === 'completed');
  if (prior.length > 0) {
    const priorFolded = fold(prior, null);
    const priorRows = rank(options.flight ? priorFolded.filter(f => f.row.flight === options.flight) : priorFolded, keys);
    const prevRank = new Map<string, number | null>();
    for (const r of priorRows) prevRank.set(r.participantId, r.rank);
    for (const r of rows) {
      r.prevRank = prevRank.get(r.participantId) ?? null;
      r.movement = r.prevRank !== null && r.rank !== null ? r.prevRank - r.rank : null;
    }
  }

  const scoredRounds = rounds.filter(r => r.rows.some(row => row.thru > 0)).map(r => r.sequence);
  return { rows, current, scoredRounds, flights, cutLine };
}

/** "▲2", "▼1", "—" — the movement column's text; the arrow is the component's, this is the accessible label's number. */
export function formatMovement(movement: number | null): { direction: 'up' | 'down' | 'same' | null; label: string } {
  if (movement === null) return { direction: null, label: '—' };
  if (movement === 0) return { direction: 'same', label: '—' };
  return movement > 0 ? { direction: 'up', label: `Up ${movement}` } : { direction: 'down', label: `Down ${Math.abs(movement)}` };
}
