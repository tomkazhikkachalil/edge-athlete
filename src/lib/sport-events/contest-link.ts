/**
 * An org-hosted event counting toward one of the org's competitions — the
 * pure half (Events program, phase 2b, B1; migration 211
 * `contests.sport_event_round_id`). Which competitions are eligible, the
 * contest row a round mints, and the refusals — all pinned by tests.
 * `contest-link-server.ts` is the ONE writer.
 *
 * Eligible: a GOLF LEADERBOARD competition with ATHLETE entrants, on the
 * event's own org, still open (not completed / archived). Tom's rule: the
 * opted-out players (hide_from_profile) still count for the org — the
 * results writer (PR 9) handles that; nothing here reads the flag. Phase 3:
 * a MATCH-PLAY event never counts toward a competition (`not_stroke_play`
 * — an org-side bracket is the masterplan's own program).
 */
import { isMatchFormat, isStablefordFormat, shapeOf } from './types';
import { type OrgKindEmbed, type OrgKindRow, orgRefOf, type OrgKind } from '@/lib/orgs/org-ref';
export interface CompetitionForLink {
  id: string;
  name: string;
  /** The owning org (Round 5 D0-b): ids are unique across kinds, so the match is on org_id alone. */
  org_id: string | null;
  org?: OrgKindEmbed;
  sport_key: string;
  format: string;
  entrant_type: string;
  status: string;
}

export type LinkRefusal = 'no_org' | 'not_stroke_play' | 'not_found' | 'other_org' | 'not_golf_leaderboard' | 'not_athletes' | 'competition_closed' | 'event_over' | 'results_exist' | 'shape_mismatch' | 'not_a_game' | 'not_two_sided' | 'already_linked' | 'contest_over' | 'sport_unsupported' | 'side_size' | 'points_format' | 'not_a_bracket' | 'not_golf_bracket' | 'bracket_shape' | 'bracket_not_drawn';

/** Track 2 PR 10: what an event IS to the bridge — a stroke-play round, a match-play round, a game or a session. */
export type EventShape = 'stroke' | 'match' | 'stableford' | 'game' | 'session';
export function eventShape(event: { sport_key?: string; format?: string | null; shape?: string | null }): EventShape {
  const shape = shapeOf({ sport_key: event.sport_key ?? 'golf', shape: event.shape });
  if (shape === 'game' || shape === 'session') return shape;
  if (isStablefordFormat(event.format)) return 'stableford';
  return isMatchFormat(event.format) ? 'match' : 'stroke';
}

/** The bridge's shape table: a golf leaderboard of athletes takes a stroke-play round (2b); a fixture of named sides in the same sport takes a GAME (PR 10); a match round reaches a golf bracket from the CONSOLE side only (PR 11 — the contest → event door; the event → competition door has nowhere to keep the intent before go-live); a session counts toward nothing. */
export function competitionAcceptsShape(c: CompetitionForLink, shape: EventShape, sportKey: string): LinkRefusal | null {
  if (shape === 'stroke') {
    if (c.sport_key !== 'golf' || c.format !== 'leaderboard') return 'not_golf_leaderboard';
    if (c.entrant_type !== 'athlete') return 'not_athletes';
    return null;
  }
  if (shape === 'game') return c.sport_key === sportKey && c.format === 'fixture' && c.entrant_type === 'ad_hoc_team' ? null : 'shape_mismatch';
  if (shape === 'stableford') return 'points_format';
  // Leftovers PR 7: a bracketed match event counts toward a golf BRACKET (athletes or ad-hoc pairs) — stage n ↔ round n, slot k ↔ match k.
  if (shape === 'match') return c.sport_key === 'golf' && c.format === 'bracket' ? null : 'not_golf_bracket';
  return 'shape_mismatch';
}

export const LINK_REFUSAL_COPY: Readonly<Record<LinkRefusal, string>> = {
  no_org: 'Only an event hosted for a club or league can count toward a competition.',
  not_stroke_play: 'A match-play event counts toward a bracket from the console: open the bracket match there and run it as an event.',
  not_found: 'That competition was not found.',
  other_org: 'That competition belongs to another organization.',
  not_golf_leaderboard: 'Only a golf leaderboard competition can count an event.',
  not_athletes: 'That competition enters teams, not athletes.',
  competition_closed: 'That competition is closed.',
  event_over: 'The event has already started — the competition can no longer change.',
  results_exist: 'Results have already been written — the link cannot be removed.',
  shape_mismatch: 'That competition does not take this kind of event — a game counts toward a fixture of named sides in the same sport; a round toward a golf leaderboard.',
  not_a_game: 'Only a fixture of two sides runs as a game event.',
  not_two_sided: 'A game needs a home and an away side.',
  already_linked: 'This game already runs as an event.',
  contest_over: 'This game is over.',
  sport_unsupported: 'This sport has no live events yet.',
  side_size: 'A match needs one player a side (singles) or two (four-ball).',
  points_format: 'A Stableford event ranks by points; the org’s golf leaderboards count strokes. Run it as stroke play to count, or keep it standalone.',
  not_a_bracket: 'Only a bracket event counts toward a bracket competition — turn on the bracket in the format settings.',
  not_golf_bracket: 'A match-play event counts toward a golf bracket competition.',
  bracket_shape: 'The bracket’s rounds must equal this event’s rounds — a stage per round.',
  bracket_not_drawn: 'Draw the bracket in the console first — the matches are linked to its slots.',
};

/** Why a competition cannot count this event, or null when it can. */
export function linkRefusal(event: { org_id: string | null; status: string; format?: string | null; sport_key?: string; shape?: string | null; bracket?: boolean | null }, competition: CompetitionForLink | null): LinkRefusal | null {
  if (!event.org_id) return 'no_org';
  const shape = eventShape(event);
  if (event.status !== 'draft' && event.status !== 'open') return 'event_over';
  if (!competition) return 'not_found';
  if (competition.org_id !== event.org_id) return 'other_org';
  const byShape = competitionAcceptsShape(competition, shape, event.sport_key ?? 'golf');
  if (byShape) return byShape;
  if (shape === 'match' && !event.bracket) return 'not_a_bracket';
  if (competition.status === 'completed' || competition.status === 'archived') return 'competition_closed';
  return null;
}

export const eligibleCompetition = (event: { org_id: string | null; format?: string | null; sport_key?: string; shape?: string | null; bracket?: boolean | null }, c: CompetitionForLink): boolean => linkRefusal({ ...event, status: 'draft' }, c) === null;

export interface GameContestRowInput {
  competition_id: string;
  sport_event_round_id: string;
  round: string | null;
  status: 'scheduled';
  venue_id: null;
  scheduled_at: string | null;
}

/** The contest a GAME round mints (PR 10): the round's label, its start as the time, no venue (trap 2 — the facility FK), no golf columns. */
export function gameContestRowFor(round: { id: string; sequence: number; starts_at?: string | null; name?: string | null }, competitionId: string): GameContestRowInput {
  return { competition_id: competitionId, sport_event_round_id: round.id, round: round.name?.trim() || null, status: 'scheduled', venue_id: null, scheduled_at: round.starts_at ?? null };
}

export interface ContestRowInput {
  competition_id: string;
  sport_event_round_id: string;
  round: string;
  holes: number;
  play_from: string;
  play_to: string;
  status: 'scheduled';
  venue_id: string | null;
  scheduled_at: null;
}

/** The contest a round mints: a one-day window on the round's DATE, its hole count, "Round n" or the round's own name. */
export function contestRowFor(round: { id: string; sequence: number; scheduled_on: string; holes: number; name?: string | null }, competitionId: string, venueId: string | null): ContestRowInput {
  return {
    competition_id: competitionId,
    sport_event_round_id: round.id,
    round: round.name?.trim() || `Round ${round.sequence}`,
    holes: round.holes,
    play_from: round.scheduled_on,
    play_to: round.scheduled_on,
    status: 'scheduled',
    venue_id: venueId,
    scheduled_at: null,
  };
}

/** The org side + id an event is hosted for. */
export function eventOrg(event: OrgKindRow): { side: OrgKind; id: string } | null {
  const ref = orgRefOf(event);
  return ref ? { side: ref.side, id: ref.orgId } : null;
}

// ── The bracket door (leftovers PR 7): a bracketed MATCH event ↔ an org golf bracket, in one act ──
// The org's contests sit at (stage, slot) (218); the event's matches at (round sequence, group sequence). The rule has ONE place:
// stage n ↔ round n, slot k ↔ match k. Nothing is minted at link time — the intent lives on `sport_events.competition_id` (221) and each
// round's matches are stamped onto the bracket's contests (220) at go-live.

/** The link-time gate: the bracket must be drawn, and its stage count must equal the event's non-cancelled round count. */
export function bracketShapeRefusal(stages: number, roundCount: number): 'bracket_not_drawn' | 'bracket_shape' | null {
  if (stages <= 0) return 'bracket_not_drawn';
  if (stages !== roundCount) return 'bracket_shape';
  return null;
}

/** Match k of round n plays slot k of stage n — the one place the mapping is written. */
export function slotForMatch(round: { sequence: number }, group: { sequence: number }): { stage: number; slot: number } {
  return { stage: round.sequence, slot: group.sequence };
}

export interface MatchForLink {
  matchId: string;
  groupSequence: number;
  /** The players on each side, as profile ids. */
  sides: [string[], string[]];
}

export interface SlotContest {
  id: string;
  stage: number;
  slot: number;
  linkedMatchId: string | null;
  hasResult: boolean;
  /** The org side's players (an athlete entry's one profile, an ad-hoc pair's members), null on an unfilled slot. */
  home: string[] | null;
  away: string[] | null;
}

export type MatchLinkOp =
  | { matchId: string; slot: number; contestId: string; action: 'stamp'; sidesAgree: boolean }
  | { matchId: string; slot: number; contestId: string | null; action: 'skip'; reason: 'no_slot' | 'has_result' | 'already_linked' | 'already' };

/** The same two sets of players, either orientation (the org may have drawn home / away the other way round). */
export function sidesAgree(eventSides: [string[], string[]], home: string[] | null, away: string[] | null): boolean {
  if (!home || !away) return false;
  const same = (a: string[], b: string[]) => a.length === b.length && a.every(p => b.includes(p));
  return (same(eventSides[0], home) && same(eventSides[1], away)) || (same(eventSides[0], away) && same(eventSides[1], home));
}

/** What go-live does to the bracket's stage: each match stamped onto its slot when the slot has no result and no other match. */
export function matchLinkPlan(matches: ReadonlyArray<MatchForLink>, contests: ReadonlyArray<SlotContest>, stage: number): MatchLinkOp[] {
  const bySlot = new Map(contests.filter(c => c.stage === stage).map(c => [c.slot, c]));
  return matches.map(m => {
    const slot = m.groupSequence;
    const c = bySlot.get(slot);
    if (!c) return { matchId: m.matchId, slot, contestId: null, action: 'skip', reason: 'no_slot' };
    if (c.linkedMatchId === m.matchId) return { matchId: m.matchId, slot, contestId: c.id, action: 'skip', reason: 'already' };
    if (c.hasResult) return { matchId: m.matchId, slot, contestId: c.id, action: 'skip', reason: 'has_result' };
    if (c.linkedMatchId) return { matchId: m.matchId, slot, contestId: c.id, action: 'skip', reason: 'already_linked' };
    return { matchId: m.matchId, slot, contestId: c.id, action: 'stamp', sidesAgree: sidesAgree(m.sides, c.home, c.away) };
  });
}

export interface MatchLinkReport {
  stage: number;
  stamped: number;
  /** The slots whose org draw disagrees with the event's sides — reported, never a gate. */
  mismatched: number[];
  skipped: Array<{ slot: number; reason: string }>;
}
