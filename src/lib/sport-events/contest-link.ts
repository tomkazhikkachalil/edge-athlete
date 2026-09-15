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
 * results writer (PR 9) handles that; nothing here reads the flag.
 */
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

export type LinkRefusal = 'no_org' | 'not_found' | 'other_org' | 'not_golf_leaderboard' | 'not_athletes' | 'competition_closed' | 'event_over' | 'results_exist';

export const LINK_REFUSAL_COPY: Readonly<Record<LinkRefusal, string>> = {
  no_org: 'Only an event hosted for a club or league can count toward a competition.',
  not_found: 'That competition was not found.',
  other_org: 'That competition belongs to another organization.',
  not_golf_leaderboard: 'Only a golf leaderboard competition can count an event.',
  not_athletes: 'That competition enters teams, not athletes.',
  competition_closed: 'That competition is closed.',
  event_over: 'The event has already started — the competition can no longer change.',
  results_exist: 'Results have already been written — the link cannot be removed.',
};

/** Why a competition cannot count this event, or null when it can. */
export function linkRefusal(event: { club_id: string | null; league_id: string | null; status: string }, competition: CompetitionForLink | null): LinkRefusal | null {
  if (!event.club_id && !event.league_id) return 'no_org';
  if (event.status !== 'draft' && event.status !== 'open') return 'event_over';
  if (!competition) return 'not_found';
  if ((event.club_id && competition.club_id !== event.club_id) || (event.league_id && competition.league_id !== event.league_id)) return 'other_org';
  if (competition.sport_key !== 'golf' || competition.format !== 'leaderboard') return 'not_golf_leaderboard';
  if (competition.entrant_type !== 'athlete') return 'not_athletes';
  if (competition.status === 'completed' || competition.status === 'archived') return 'competition_closed';
  return null;
}

export const eligibleCompetition = (event: { club_id: string | null; league_id: string | null }, c: CompetitionForLink): boolean => linkRefusal({ ...event, status: 'draft' }, c) === null;

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
