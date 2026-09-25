/**
 * Match play — the pure engine (Events program, phase 3). A MATCH is a
 * group with two SIDES on a match-format round; the strokes stay on the
 * cards, and what a card cannot carry (a concession, the sudden-death
 * extra holes — `golf_hole_scores.hole_number` is CHECK 1..18 —, an
 * organizer's decision, a bye) rides in as the match row's intent. The
 * STATUS is computed here on every read — never stored while live; the
 * outcome is written once at round completion (`completionSnapshot`).
 *
 * The rules, each pinned by __tests__/match.test.ts:
 *   - a hole is contested when both sides have a counting score; the
 *     lower wins it, a tie halves it; a conceded hole goes to the OTHER
 *     side whatever the scores;
 *   - the side's counting score is its own ball (singles), the better
 *     NET ball (four-ball), or the captain's card (foursomes — one ball
 *     per side, held by the side's position-1 member);
 *   - net (match_net): playing handicap = round(CH × allowance); singles
 *     give the difference to the lower player, four-ball gives EACH player
 *     the difference to the lowest of the four (a side has no single
 *     handicap in four-ball), foursomes give the lower side's difference
 *     to the higher side's captain — strokes fall on the holes by stroke
 *     index (`strokesForHole` over the played holes' re-ranked indexes,
 *     the leaderboard's rule); a missing index or stroke index makes the
 *     match GROSS with the reason — never a guessed stroke;
 *   - `up` is signed for side 1; closed out when the lead exceeds the
 *     holes remaining ("3&2"); won on the last ("2 up"); dormie when the
 *     lead equals the holes remaining; all square after the last hole →
 *     sudden death, extra hole n plays the round's holes in order from the
 *     first, the first hole won decides ("20 holes");
 *   - a stored decision (the organizer's, a conceded match, a bye) wins
 *     over the computation.
 */
import { rankStrokeIndexes, strokesForHole } from '@/lib/golf/adjusted-gross';
import type { NetReason } from './leaderboard';
import type { Side } from './match-types';
import type { MatchSides, SportEventHoleDatum } from './types';

export type MatchFormat = 'match_gross' | 'match_net';
export type { Side } from './match-types';
export { MATCH_ALLOWANCE_DEFAULT } from './format-config';
export const MATCH_SIDE_SIZE: Readonly<Record<MatchSides, 1 | 2>> = { singles: 1, fourball: 2, foursomes: 2 };
export { MATCH_SIDES_LABEL } from './format';
export const EXTRA_HOLE_MAX = 9;

export interface MatchPlayer {
  participantId: string;
  profileId: string;
  name: string;
  position: number;
  courseHandicap: number | null;
  holeScores: ReadonlyArray<{ hole_number: number; strokes: number | null }>;
}
export interface MatchSideInput {
  side: Side;
  /** Position order; on foursomes players[0] is the captain whose card counts. */
  players: MatchPlayer[];
}
export interface Concession {
  /** The hole given, or null for the match. */
  hole: number | null;
  /** The side that GIVES it (its own hole); the other side wins. */
  by_side: Side;
  by: string;
  at: string;
}
export interface ExtraHole {
  n: number;
  hole_number: number;
  /** Strokes per participant on the extra hole (null = not yet). */
  strokes: Record<string, number | null>;
}
export type MatchDecidedBy = 'holes' | 'concession' | 'extra_holes' | 'organizer' | 'bye';
export type StoredDecision = { decided_by: 'organizer' | 'concession' | 'bye'; winner_side: Side } | null;

export interface MatchInput {
  format: MatchFormat;
  sides: MatchSides;
  allowancePct: number;
  holes: 9 | 18;
  /** The round's holes in play order (rotated to the group's starting hole — `holeOrderFor`). */
  holeOrder: number[];
  holeData: SportEventHoleDatum[] | null;
  sideA: MatchSideInput;
  sideB: MatchSideInput;
  concessions: Concession[];
  extraHoles: ExtraHole[];
  decision: StoredDecision;
  /** The outcome written ONCE at round completion (212), when there is one.
   *  Departed accounts (Sep 24 2026): it wins over the bye reading when a
   *  side has since lost its players — an erased minor's opponent keeps the
   *  win they earned. */
  written?: { decided_by: MatchDecidedBy; winner_side: Side; result: string } | null;
}

export interface HoleOutcome {
  /** 1.. in play order; extra holes continue the count. */
  n: number;
  hole: number;
  par: number;
  extra: boolean;
  conceded: boolean;
  /** null = not contested yet. */
  winner: Side | null;
  halved: boolean;
  sideScore: Record<Side, number | null>;
  /** Strokes received per participant on this hole (net only). */
  received: Record<string, number>;
}

export interface MatchState {
  status: 'not_started' | 'live' | 'completed';
  holes: HoleOutcome[];
  /** Signed for side 1 (+2 = side 1 is 2 up). */
  up: number;
  thru: number;
  remaining: number;
  dormie: boolean;
  closedOut: boolean;
  allSquareAfterLast: boolean;
  needsExtraHole: boolean;
  /** The next extra hole's number and default hole, when one is needed. */
  nextExtraHole: { n: number; hole_number: number } | null;
  winnerSide: Side | null;
  decidedBy: MatchDecidedBy | null;
  /** "3&2" · "2 up" · "20 holes" · "conceded" · "decided" · "bye" */
  result: string | null;
  summary: string;
  playingHandicaps: Record<string, number | null>;
  strokesGiven: Record<string, number>;
  netReason: NetReason;
}

const other = (s: Side): Side => (s === 1 ? 2 : 1);

/** The round's holes in play order: the round's own order rotated to the group's starting hole (a shotgun); a start outside the round's holes keeps the round's order. */
export function holeOrderFor(round: { holes: 9 | 18; starting_hole: number }, groupStartingHole: number | null | undefined): number[] {
  const base = Array.from({ length: round.holes }, (_, i) => ((round.starting_hole - 1 + i) % 18) + 1);
  const at = groupStartingHole ? base.indexOf(groupStartingHole) : -1;
  return at <= 0 ? base : [...base.slice(at), ...base.slice(0, at)];
}

/** The playing handicaps and the strokes each participant RECEIVES (the difference to the lowest); any missing course handicap → no strokes, reason `no_index`. */
export function playingHandicaps(sides: MatchSides, allowancePct: number, sideA: MatchSideInput, sideB: MatchSideInput): { perPlayer: Record<string, number | null>; given: Record<string, number>; reason: NetReason } {
  const players = [...sideA.players, ...sideB.players];
  const perPlayer: Record<string, number | null> = {};
  const given: Record<string, number> = {};
  for (const p of players) { perPlayer[p.participantId] = null; given[p.participantId] = 0; }
  if (players.length === 0 || players.some(p => p.courseHandicap === null)) return { perPlayer, given, reason: players.length === 0 ? null : 'no_index' };
  const a = allowancePct / 100;
  if (sides === 'foursomes') {
    const sidePh = (s: MatchSideInput) => Math.round(s.players.reduce((sum, p) => sum + (p.courseHandicap as number), 0) * a);
    const phA = sidePh(sideA);
    const phB = sidePh(sideB);
    const low = Math.min(phA, phB);
    for (const p of sideA.players) perPlayer[p.participantId] = phA;
    for (const p of sideB.players) perPlayer[p.participantId] = phB;
    if (sideA.players[0]) given[sideA.players[0].participantId] = phA - low;
    if (sideB.players[0]) given[sideB.players[0].participantId] = phB - low;
    return { perPlayer, given, reason: null };
  }
  // Singles and four-ball: per player, the difference to the lowest of everyone.
  for (const p of players) perPlayer[p.participantId] = Math.round((p.courseHandicap as number) * a);
  const low = Math.min(...players.map(p => perPlayer[p.participantId] as number));
  for (const p of players) given[p.participantId] = (perPlayer[p.participantId] as number) - low;
  return { perPlayer, given, reason: null };
}

/** The participants whose cards count: everyone on singles / four-ball, the captains on foursomes. */
export function countingPlayers(sides: MatchSides, side: MatchSideInput): MatchPlayer[] {
  return sides === 'foursomes' ? side.players.slice(0, 1) : side.players;
}

function strokesOn(p: MatchPlayer, hole: number): number | null {
  const h = p.holeScores.find(x => x.hole_number === hole);
  return h && typeof h.strokes === 'number' && h.strokes > 0 ? h.strokes : null;
}

function rankedIndexes(holeOrder: number[], holeData: SportEventHoleDatum[] | null): Map<number, number | null> {
  const si = new Map<number, number | null>();
  for (const h of holeData ?? []) si.set(h.hole, typeof h.handicap === 'number' && h.handicap > 0 ? h.handicap : null);
  const ranked = rankStrokeIndexes(holeOrder.map(n => si.get(n) ?? null));
  const out = new Map<number, number | null>();
  holeOrder.forEach((n, i) => out.set(n, ranked[i]));
  return out;
}

interface Scoring {
  net: boolean;
  given: Record<string, number>;
  ranked: Map<number, number | null>;
  parOf: (hole: number) => number;
}

function sideScoreOn(side: MatchSideInput, sides: MatchSides, hole: number, strokesOf: (p: MatchPlayer, hole: number) => number | null, sc: Scoring, received: Record<string, number>): number | null {
  let best: number | null = null;
  for (const p of countingPlayers(sides, side)) {
    const raw = strokesOf(p, hole);
    if (raw === null) continue;
    let s = raw;
    if (sc.net) {
      const si = sc.ranked.get(hole);
      const g = sc.given[p.participantId] ?? 0;
      const r = g !== 0 && typeof si === 'number' ? strokesForHole(g, si) : 0;
      received[p.participantId] = r;
      s = raw - r;
    }
    if (best === null || s < best) best = s;
  }
  return best;
}

function outcomeFor(n: number, hole: number, extra: boolean, input: MatchInput, sc: Scoring, strokesOf: (p: MatchPlayer, hole: number) => number | null, conceded: Concession | undefined): HoleOutcome | null {
  const received: Record<string, number> = {};
  const par = sc.parOf(hole);
  if (conceded) {
    const w = other(conceded.by_side);
    return { n, hole, par, extra, conceded: true, winner: w, halved: false, sideScore: { 1: null, 2: null }, received };
  }
  const a = sideScoreOn(input.sideA, input.sides, hole, strokesOf, sc, received);
  const b = sideScoreOn(input.sideB, input.sides, hole, strokesOf, sc, received);
  if (a === null || b === null) return null;
  const winner: Side | null = a < b ? 1 : b < a ? 2 : null;
  return { n, hole, par, extra, conceded: false, winner, halved: winner === null, sideScore: { 1: a, 2: b }, received };
}

export function computeMatch(input: MatchInput): MatchState {
  const names = { 1: input.sideA.players.map(p => p.name).join(' & ') || 'Side 1', 2: input.sideB.players.map(p => p.name).join(' & ') || 'Side 2' };
  const empty: MatchState = { status: 'not_started', holes: [], up: 0, thru: 0, remaining: input.holes, dormie: false, closedOut: false, allSquareAfterLast: false, needsExtraHole: false, nextExtraHole: null, winnerSide: null, decidedBy: null, result: null, summary: 'Not started', playingHandicaps: {}, strokesGiven: {}, netReason: null };

  // A bye: one side only.
  if (input.sideA.players.length === 0 || input.sideB.players.length === 0) {
    const wr = input.written;
    if (wr && wr.decided_by !== 'bye') {
      const w = wr.winner_side;
      return { ...empty, status: 'completed', winnerSide: w, decidedBy: wr.decided_by, result: wr.result, summary: `${names[w]} wins ${wr.result}` };
    }
    const w: Side = input.sideA.players.length > 0 ? 1 : 2;
    return { ...empty, status: 'completed', winnerSide: w, decidedBy: 'bye', result: 'bye', summary: `${names[w]} · bye` };
  }

  const hc = playingHandicaps(input.sides, input.allowancePct, input.sideA, input.sideB);
  const ranked = rankedIndexes(input.holeOrder, input.holeData);
  let netReason: NetReason = input.format === 'match_net' ? hc.reason : null;
  let net = input.format === 'match_net' && netReason === null && Object.values(hc.given).some(g => g !== 0);
  if (net && input.holeOrder.some(h => ranked.get(h) === null || ranked.get(h) === undefined)) { net = false; netReason = 'no_stroke_index'; }
  const parByHole = new Map((input.holeData ?? []).map(h => [h.hole, h.par]));
  const sc: Scoring = { net, given: net ? hc.given : {}, ranked, parOf: hole => parByHole.get(hole) ?? 4 };

  const concededByHole = new Map<number, Concession>();
  let matchConceded: Concession | null = null;
  for (const c of input.concessions) {
    if (c.hole === null) matchConceded = matchConceded ?? c;
    else if (!concededByHole.has(c.hole)) concededByHole.set(c.hole, c);
  }

  const holes: HoleOutcome[] = [];
  let up = 0;
  for (let i = 0; i < input.holeOrder.length; i++) {
    const hole = input.holeOrder[i];
    const o = outcomeFor(i + 1, hole, false, input, sc, strokesOn, concededByHole.get(hole));
    if (!o) continue;
    holes.push(o);
    if (o.winner === 1) up += 1;
    else if (o.winner === 2) up -= 1;
  }
  const thru = holes.length;
  const remaining = Math.max(0, input.holes - thru);
  const lead = Math.abs(up);
  const closedOut = lead > remaining && remaining > 0;
  const wonOnLast = remaining === 0 && lead > 0;
  const dormie = lead > 0 && lead === remaining && remaining > 0;
  const allSquareAfterLast = remaining === 0 && lead === 0 && thru > 0;

  const base: MatchState = { ...empty, holes, up, thru, remaining, dormie, closedOut, allSquareAfterLast, playingHandicaps: hc.perPlayer, strokesGiven: net ? hc.given : {}, netReason, status: thru > 0 || input.concessions.length > 0 ? 'live' : 'not_started' };

  // A stored decision wins over the computation.
  if (input.decision) {
    const w = input.decision.winner_side;
    const by = input.decision.decided_by;
    const result = by === 'concession' ? 'conceded' : by === 'bye' ? 'bye' : 'decided';
    return { ...base, status: 'completed', winnerSide: w, decidedBy: by, result, summary: by === 'bye' ? `${names[w]} · bye` : by === 'concession' ? `${names[w]} wins · conceded` : `${names[w]} wins · decided by the organizer` };
  }
  if (matchConceded) {
    const w = other(matchConceded.by_side);
    return { ...base, status: 'completed', winnerSide: w, decidedBy: 'concession', result: 'conceded', summary: `${names[w]} wins · conceded` };
  }
  if (closedOut || wonOnLast) {
    const w: Side = up > 0 ? 1 : 2;
    const result = closedOut ? `${lead}&${remaining}` : `${lead} up`;
    return { ...base, status: 'completed', winnerSide: w, decidedBy: 'holes', result, summary: `${names[w]} wins ${result}` };
  }
  if (allSquareAfterLast) {
    // Sudden death: the round's holes in order from the first; the first hole won decides.
    const extras = [...input.extraHoles].sort((a, b) => a.n - b.n);
    const strokesFromExtra = (e: ExtraHole) => (p: MatchPlayer) => { const v = e.strokes[p.participantId]; return typeof v === 'number' && v > 0 ? v : null; };
    for (const e of extras) {
      const o = outcomeFor(input.holes + e.n, e.hole_number, true, input, sc, strokesFromExtra(e), undefined);
      if (!o) break;
      holes.push(o);
      if (o.winner) {
        const result = `${input.holes + e.n} holes`;
        return { ...base, holes, thru: thru + e.n, winnerSide: o.winner, decidedBy: 'extra_holes', status: 'completed', result, summary: `${names[o.winner]} wins · ${result}` };
      }
    }
    const nextN = extras.filter(e => holes.some(h => h.extra && h.n === input.holes + e.n)).length + 1;
    const nextExtraHole = nextN <= EXTRA_HOLE_MAX ? { n: nextN, hole_number: input.holeOrder[(nextN - 1) % input.holeOrder.length] } : null;
    return { ...base, holes, thru: thru + (nextN - 1), needsExtraHole: nextExtraHole !== null, nextExtraHole, summary: `All square after ${input.holes} · extra holes` };
  }
  const leader: Side | null = up > 0 ? 1 : up < 0 ? 2 : null;
  const summary = thru === 0 ? 'Not started' : leader === null ? `All square thru ${thru}` : dormie ? `${names[leader]} dormie ${lead}` : `${names[leader]} ${lead} UP thru ${thru}`;
  return { ...base, summary };
}

/** The outcome the round's completion writes for a match not yet stored-decided; null when the match is still open (the organizer decides). */
export function completionSnapshot(state: MatchState): { decided_by: 'holes' | 'extra_holes'; winner_side: Side; result: string } | null {
  if (state.status !== 'completed' || (state.decidedBy !== 'holes' && state.decidedBy !== 'extra_holes') || !state.winnerSide || !state.result) return null;
  return { decided_by: state.decidedBy, winner_side: state.winnerSide, result: state.result };
}

// ── The groups' shape for a match round ────────────────────────────────────

export type SideRefusal = 'no_side' | 'wrong_size' | 'too_many' | 'empty';

/** The two sides of a group, by position; a one-side group is a bye only when allowed. */
export function sidesOf(members: ReadonlyArray<{ participant_id: string; position: number; side: Side | null }>, sides: MatchSides, opts: { allowBye?: boolean } = {}): { ok: true; a: string[]; b: string[]; bye: boolean } | { ok: false; reason: SideRefusal } {
  if (members.length === 0) return { ok: false, reason: 'empty' };
  if (members.some(m => m.side !== 1 && m.side !== 2)) return { ok: false, reason: 'no_side' };
  const by = (s: Side) => [...members].filter(m => m.side === s).sort((x, y) => x.position - y.position).map(m => m.participant_id);
  const a = by(1);
  const b = by(2);
  const size = MATCH_SIDE_SIZE[sides];
  if (a.length > size || b.length > size) return { ok: false, reason: 'too_many' };
  if (a.length === size && b.length === size) return { ok: true, a, b, bye: false };
  if (opts.allowBye && ((a.length === size && b.length === 0) || (b.length === size && a.length === 0))) return { ok: true, a, b, bye: true };
  return { ok: false, reason: 'wrong_size' };
}

/** The groups a match round cannot start with, by sequence — the `groups_incomplete` refusal names them. */
export function groupsIncomplete(groups: ReadonlyArray<{ sequence: number; members: ReadonlyArray<{ participant_id: string; position: number; side: Side | null }> }>, sides: MatchSides, bracket: boolean): Array<{ sequence: number; reason: SideRefusal }> {
  const out: Array<{ sequence: number; reason: SideRefusal }> = [];
  for (const g of groups) {
    const r = sidesOf(g.members, sides, { allowBye: bracket });
    if (!r.ok) out.push({ sequence: g.sequence, reason: r.reason });
  }
  return out;
}

/** Sides derived from positions for singles when a plain id list arrives (phase-1/2 bodies stay legal): position 1 → side 1, position 2 → side 2. */
export function singlesSideFor(position: number): Side | null {
  return position === 1 ? 1 : position === 2 ? 2 : null;
}

// ── The writes' rules ─────────────────────────────────────────────────────

export type ConcessionRefusal = 'match_decided' | 'hole_outside_round' | 'already_conceded' | 'hole_already_played';
export type ExtraHoleRefusal = 'match_decided' | 'not_all_square' | 'wrong_extra_hole' | 'hole_outside_round' | 'unknown_participant' | 'bad_strokes';

export function concessionRefusal(state: MatchState, input: MatchInput, c: { hole: number | null }): ConcessionRefusal | null {
  if (state.status === 'completed') return 'match_decided';
  if (c.hole === null) return null;
  if (!input.holeOrder.includes(c.hole)) return 'hole_outside_round';
  if (input.concessions.some(x => x.hole === c.hole)) return 'already_conceded';
  if (state.holes.some(h => !h.extra && h.hole === c.hole && !h.conceded)) return 'hole_already_played';
  return null;
}

export function extraHoleRefusal(state: MatchState, input: MatchInput, e: { n: number; hole_number: number; strokes: Record<string, unknown> }): ExtraHoleRefusal | null {
  if (state.status === 'completed') return 'match_decided';
  if (!state.needsExtraHole || !state.nextExtraHole) return 'not_all_square';
  if (e.n !== state.nextExtraHole.n) return 'wrong_extra_hole';
  if (!input.holeOrder.includes(e.hole_number)) return 'hole_outside_round';
  const counting = new Set([...countingPlayers(input.sides, input.sideA), ...countingPlayers(input.sides, input.sideB)].map(p => p.participantId));
  for (const [pid, v] of Object.entries(e.strokes)) {
    if (!counting.has(pid)) return 'unknown_participant';
    if (v !== null && (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 15)) return 'bad_strokes';
  }
  return null;
}

export type MatchRouteRefusal = 'not_a_side' | 'conflict' | 'round_not_live' | 'not_organizer_decision' | 'not_match_play' | 'not_stroke_play';
export const MATCH_REFUSAL_COPY: Readonly<Record<ConcessionRefusal | ExtraHoleRefusal | MatchRouteRefusal, string>> = {
  match_decided: 'This match has been decided.',
  hole_outside_round: 'That hole is not on this round.',
  already_conceded: 'That hole was already conceded.',
  hole_already_played: 'That hole has been played — the scores decide it.',
  not_all_square: 'Extra holes start only when the match is all square after the last hole.',
  wrong_extra_hole: 'Enter the extra holes in order.',
  unknown_participant: 'That player is not in this match.',
  bad_strokes: 'Strokes are a whole number from 1 to 15.',
  not_a_side: 'Only a player on the side, or an organizer, can concede for it.',
  conflict: 'The match changed while you were working. Reload and try again.',
  round_not_live: 'The round is not live — a match can only change while its round is being played.',
  not_organizer_decision: 'Only a decision made by an organizer can be cleared.',
  not_match_play: 'This event is stroke play — it has no matches.',
  not_stroke_play: 'This event is match play — see the Matches tab.',
};
