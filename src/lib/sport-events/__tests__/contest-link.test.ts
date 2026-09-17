import { describe, expect, it } from 'vitest';
import { competitionAcceptsShape, contestRowFor, eligibleCompetition, eventOrg, eventShape, gameContestRowFor, LINK_REFUSAL_COPY, linkRefusal, type CompetitionForLink } from '../contest-link';

const club = { club_id: 'c1', league_id: null, status: 'open' };
const comp = (patch: Partial<CompetitionForLink> = {}): CompetitionForLink => ({ id: 'k1', name: 'Club Cup', club_id: 'c1', league_id: null, sport_key: 'golf', format: 'leaderboard', entrant_type: 'athlete', status: 'active', ...patch });

describe('linkRefusal — which competitions may count an event', () => {
  it('admits a golf leaderboard of athletes on the event\'s own org while draft / open', () => {
    expect(linkRefusal(club, comp())).toBeNull();
    expect(linkRefusal({ ...club, status: 'draft' }, comp())).toBeNull();
    expect(eligibleCompetition(club, comp())).toBe(true);
  });
  it('names every refusal, and every refusal has copy', () => {
    expect(linkRefusal({ club_id: null, league_id: null, status: 'open' }, comp())).toBe('no_org');
    expect(linkRefusal({ ...club, format: 'match_gross' }, comp())).toBe('not_stroke_play');
    expect(linkRefusal({ ...club, format: 'match_net' }, comp())).toBe('not_stroke_play');
    expect(linkRefusal({ ...club, format: 'stroke_net' }, comp())).toBeNull();
    expect(eligibleCompetition({ ...club, format: 'match_gross' }, comp())).toBe(false);
    expect(linkRefusal({ ...club, status: 'live' }, comp())).toBe('event_over');
    expect(linkRefusal(club, null)).toBe('not_found');
    expect(linkRefusal(club, comp({ club_id: 'c2' }))).toBe('other_org');
    expect(linkRefusal({ club_id: null, league_id: 'l1', status: 'open' }, comp({ club_id: null, league_id: 'l2' }))).toBe('other_org');
    expect(linkRefusal(club, comp({ format: 'fixture' }))).toBe('not_golf_leaderboard');
    expect(linkRefusal(club, comp({ sport_key: 'ice_hockey' }))).toBe('not_golf_leaderboard');
    expect(linkRefusal(club, comp({ entrant_type: 'team' }))).toBe('not_athletes');
    expect(linkRefusal(club, comp({ status: 'completed' }))).toBe('competition_closed');
    for (const key of ['no_org', 'not_stroke_play', 'not_found', 'other_org', 'not_golf_leaderboard', 'not_athletes', 'competition_closed', 'event_over', 'results_exist', 'shape_mismatch', 'not_a_game', 'not_two_sided', 'already_linked', 'contest_over', 'sport_unsupported', 'side_size', 'points_format'] as const) expect(LINK_REFUSAL_COPY[key]).toBeTruthy();
  });
});

describe('contestRowFor + eventOrg', () => {
  it('mints a one-day window on the round\'s date with its holes, named "Round n" or by the round\'s own name', () => {
    expect(contestRowFor({ id: 'r2', sequence: 2, scheduled_on: '2030-06-02', holes: 18, name: null }, 'k1', 'v1')).toEqual({ competition_id: 'k1', sport_event_round_id: 'r2', round: 'Round 2', holes: 18, play_from: '2030-06-02', play_to: '2030-06-02', status: 'scheduled', venue_id: 'v1', scheduled_at: null });
    expect(contestRowFor({ id: 'r1', sequence: 1, scheduled_on: '2030-06-01', holes: 9, name: ' Saturday ' }, 'k1', null).round).toBe('Saturday');
    expect(eventOrg({ club_id: 'c1', league_id: null })).toEqual({ side: 'club', id: 'c1' });
    expect(eventOrg({ club_id: null, league_id: 'l1' })).toEqual({ side: 'league', id: 'l1' });
    expect(eventOrg({ club_id: null, league_id: null })).toBeNull();
  });
});

describe('the shape table (track 2 PR 10) — which competition takes which event', () => {
  const game = { ...club, sport_key: 'ice_hockey', shape: 'game' as const };
  const pickup = (patch: Partial<CompetitionForLink> = {}) => comp({ sport_key: 'ice_hockey', format: 'fixture', entrant_type: 'ad_hoc_team', ...patch });
  it('reads the shape: golf is stroke or match; a team sport is a game or a session', () => {
    expect(eventShape({ sport_key: 'golf', format: 'stroke_net' })).toBe('stroke');
    expect(eventShape({ sport_key: 'golf', format: 'match_gross', shape: 'round' })).toBe('match');
    expect(eventShape({ sport_key: 'ice_hockey', shape: 'game' })).toBe('game');
    expect(eventShape({ sport_key: 'soccer', shape: 'session' })).toBe('session');
    expect(eventShape({})).toBe('stroke');
    expect(eventShape({ sport_key: 'golf', format: 'stableford_net' })).toBe('stableford');
    expect(linkRefusal({ ...club, format: 'stableford_gross' }, comp())).toBe('points_format');
    expect(eligibleCompetition({ ...club, format: 'stableford_net' }, comp())).toBe(false);
  });
  it('a game counts toward a fixture of named sides in the SAME sport; a session toward nothing; a stroke round keeps the 2b rule', () => {
    expect(linkRefusal(game, pickup())).toBeNull();
    expect(eligibleCompetition(game, pickup())).toBe(true);
    expect(linkRefusal(game, pickup({ sport_key: 'soccer' }))).toBe('shape_mismatch');
    expect(linkRefusal(game, pickup({ entrant_type: 'team' }))).toBe('shape_mismatch');
    expect(linkRefusal(game, pickup({ format: 'bracket' }))).toBe('shape_mismatch');
    expect(linkRefusal(game, comp())).toBe('shape_mismatch');
    expect(linkRefusal({ ...game, shape: 'session' }, pickup())).toBe('shape_mismatch');
    expect(linkRefusal(club, pickup())).toBe('not_golf_leaderboard');
    expect(competitionAcceptsShape(pickup(), 'match', 'ice_hockey')).toBe('not_stroke_play');
    expect(linkRefusal({ ...game, status: 'live' }, pickup())).toBe('event_over');
    expect(linkRefusal(game, pickup({ status: 'archived' }))).toBe('competition_closed');
  });
  it('a game round mints a contest with its label and start, no venue, no golf columns', () => {
    expect(gameContestRowFor({ id: 'r1', sequence: 1, starts_at: '2030-06-01T19:30:00.000Z', name: ' Week 3 ' }, 'k1')).toEqual({ competition_id: 'k1', sport_event_round_id: 'r1', round: 'Week 3', status: 'scheduled', venue_id: null, scheduled_at: '2030-06-01T19:30:00.000Z' });
    expect(gameContestRowFor({ id: 'r1', sequence: 1 }, 'k1')).toMatchObject({ round: null, scheduled_at: null });
  });
});
