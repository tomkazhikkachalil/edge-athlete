/**
 * The match view — the pure projection (Events program, phase 3, PR 6).
 * One rule for what leaves the server: names through publicDisplayName
 * (already masked by the reader), the computed state, the intent the row
 * holds (concessions, extra holes, the stored decision) and the `version`
 * every write must carry — never a hole score (the group card has them),
 * never a profile's private fields.
 */
import type { BracketMatch } from './bracket';
import type { Concession, ExtraHole, MatchState, Side } from './match';
import type { MatchSides } from './types';

export interface MatchMemberView {
  participant_id: string;
  profile_id: string;
  name: string;
  handle: string | null;
  avatar_url: string | null;
}

export interface MatchSideProjection {
  side: Side;
  members: MatchMemberView[];
  card_participant_ids: string[];
}

export interface MatchView {
  id: string;
  version: number;
  round_id: string;
  group: { id: string; sequence: number; name: string | null; starting_hole: number; tee_time: string | null };
  /** "Match 3" or the group's own name. */
  title: string;
  /** "Ann vs Bob" · "Ann & Al vs Bob & Ben" (a bye names one side). */
  line: string;
  sides: [MatchSideProjection, MatchSideProjection];
  bye: boolean;
  holes: 9 | 18;
  hole_order: number[];
  concessions: Concession[];
  extra_holes: ExtraHole[];
  stored: { decided_by: string | null; winner_side: Side | null; result: string | null; decided_at: string | null };
  state: MatchState;
}

export interface MatchProjectionInput {
  id: string;
  version: number;
  round_id: string;
  group: MatchView['group'];
  sides: [MatchSideProjection, MatchSideProjection];
  bye: boolean;
  input: { holes: 9 | 18; holeOrder: number[]; concessions: Concession[]; extraHoles: ExtraHole[] };
  state: MatchState;
  stored: MatchView['stored'];
}

export const sideNames = (members: ReadonlyArray<{ name: string }>): string => members.map(m => m.name).join(' & ');

export function matchTitle(group: { sequence: number; name: string | null }): string {
  return group.name?.trim() || `Match ${group.sequence}`;
}

export function matchLine(sides: readonly [{ members: ReadonlyArray<{ name: string }> }, { members: ReadonlyArray<{ name: string }> }]): string {
  const a = sideNames(sides[0].members);
  const b = sideNames(sides[1].members);
  if (!a || !b) return `${a || b} · bye`;
  return `${a} vs ${b}`;
}

export function projectMatch(m: MatchProjectionInput): MatchView {
  return {
    id: m.id,
    version: m.version,
    round_id: m.round_id,
    group: m.group,
    title: matchTitle(m.group),
    line: matchLine(m.sides),
    sides: m.sides,
    bye: m.bye,
    holes: m.input.holes,
    hole_order: m.input.holeOrder,
    concessions: m.input.concessions,
    extra_holes: m.input.extraHoles,
    stored: m.stored,
    state: m.state,
  };
}

/** The GET payload: the event's match options, the rounds as columns, every match (or one round's). */
export interface EventMatchesPayload {
  event: { id: string; format: string; status: string; match: { sides: MatchSides; bracket: boolean; allowance: number } };
  rounds: Array<{ id: string; sequence: number; name: string | null; status: string; holes: number; scheduled_on: string; group_post_id: string | null }>;
  matches: MatchView[];
  computed_at: string;
}

/** The group card's columns on a match round: the counting cards only (foursomes → the captains), side 1 first, then by position. */
export function matchColumns<T extends { participant_id: string; profile_id: string; position: number; side?: 1 | 2 | null }>(members: ReadonlyArray<T>, cardParticipantIds: ReadonlyArray<string>): T[] {
  const counting = new Set(cardParticipantIds);
  return [...members].filter(m => counting.has(m.participant_id)).sort((a, b) => ((a.side ?? 3) - (b.side ?? 3)) || (a.position - b.position));
}

/** The route's matches as the bracket's per-round model (`bracket.ts`), keyed by round id; the names of everyone in them beside. */
export function bracketMatchesFrom(matches: ReadonlyArray<Pick<MatchView, 'round_id' | 'group' | 'sides' | 'state'>>): { byRound: Map<string, BracketMatch[]>; names: Map<string, string> } {
  const byRound = new Map<string, BracketMatch[]>();
  const names = new Map<string, string>();
  for (const m of matches) {
    for (const s of m.sides) for (const p of s.members) names.set(p.participant_id, p.name);
    const list = byRound.get(m.round_id) ?? [];
    list.push({ sequence: m.group.sequence, groupId: m.group.id, sides: [m.sides[0].members.map(p => p.participant_id), m.sides[1].members.map(p => p.participant_id)], winnerSide: m.state.winnerSide, decidedBy: m.state.decidedBy, result: m.state.result });
    byRound.set(m.round_id, list);
  }
  return { byRound, names };
}

/** The match a viewer may act on: the side they play (by profile), or null. */
export function sideOfViewer(match: Pick<MatchView, 'sides'>, profileId: string | null): Side | null {
  if (!profileId) return null;
  for (const s of match.sides) if (s.members.some(m => m.profile_id === profileId)) return s.side;
  return null;
}
