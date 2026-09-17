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
import { isMatchFormat, shapeOf } from './types';
export interface CompetitionForLink {
  id: string;
  name: string;
  club_id: string | null;
  league_id: string | null;
  sport_key: string;
  format: string;
  entrant_type: string;
  status: string;
}

export type LinkRefusal = 'no_org' | 'not_stroke_play' | 'not_found' | 'other_org' | 'not_golf_leaderboard' | 'not_athletes' | 'competition_closed' | 'event_over' | 'results_exist' | 'shape_mismatch' | 'not_a_game' | 'not_two_sided' | 'already_linked' | 'contest_over' | 'sport_unsupported' | 'side_size';

/** Track 2 PR 10: what an event IS to the bridge — a stroke-play round, a match-play round, a game or a session. */
export type EventShape = 'stroke' | 'match' | 'game' | 'session';
export function eventShape(event: { sport_key?: string; format?: string | null; shape?: string | null }): EventShape {
  const shape = shapeOf({ sport_key: event.sport_key ?? 'golf', shape: event.shape });
  if (shape === 'game' || shape === 'session') return shape;
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
  return shape === 'match' ? 'not_stroke_play' : 'shape_mismatch';
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
};

/** Why a competition cannot count this event, or null when it can. */
export function linkRefusal(event: { club_id: string | null; league_id: string | null; status: string; format?: string | null; sport_key?: string; shape?: string | null }, competition: CompetitionForLink | null): LinkRefusal | null {
  if (!event.club_id && !event.league_id) return 'no_org';
  const shape = eventShape(event);
  if (shape === 'match') return 'not_stroke_play';
  if (event.status !== 'draft' && event.status !== 'open') return 'event_over';
  if (!competition) return 'not_found';
  if ((event.club_id && competition.club_id !== event.club_id) || (event.league_id && competition.league_id !== event.league_id)) return 'other_org';
  const byShape = competitionAcceptsShape(competition, shape, event.sport_key ?? 'golf');
  if (byShape) return byShape;
  if (competition.status === 'completed' || competition.status === 'archived') return 'competition_closed';
  return null;
}

export const eligibleCompetition = (event: { club_id: string | null; league_id: string | null; format?: string | null; sport_key?: string; shape?: string | null }, c: CompetitionForLink): boolean => linkRefusal({ ...event, status: 'draft' }, c) === null;

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
export function eventOrg(event: { club_id: string | null; league_id: string | null }): { side: 'club' | 'league'; id: string } | null {
  if (event.club_id) return { side: 'club', id: event.club_id };
  if (event.league_id) return { side: 'league', id: event.league_id };
  return null;
}
