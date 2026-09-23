import { describe, expect, it } from 'vitest';
import { bracketShapeRefusal, competitionAcceptsShape, contestRowFor, eligibleCompetition, eventOrg, eventShape, gameContestRowFor, LINK_REFUSAL_COPY, linkRefusal, matchLinkPlan, sidesAgree, slotForMatch, type CompetitionForLink } from '../contest-link';

const club = { org_id: 'c1', status: 'open' };
const comp = (patch: Partial<CompetitionForLink> = {}): CompetitionForLink => ({ id: 'k1', name: 'Club Cup', org_id: 'c1', org: { kind: 'club' }, sport_key: 'golf', format: 'leaderboard', entrant_type: 'athlete', status: 'active', ...patch });

describe('linkRefusal — which competitions may count an event', () => {
  it('admits a golf leaderboard of athletes on the event\'s own org while draft / open', () => {
    expect(linkRefusal(club, comp())).toBeNull();
    expect(linkRefusal({ ...club, status: 'draft' }, comp())).toBeNull();
    expect(eligibleCompetition(club, comp())).toBe(true);
  });
  it('names every refusal, and every refusal has copy', () => {
    expect(linkRefusal({ org_id: null, status: 'open' }, comp())).toBe('no_org');
    // Leftovers PR 7: a match event reaches a golf BRACKET; a leaderboard is not its home.
    expect(linkRefusal({ ...club, format: 'match_gross' }, comp())).toBe('not_golf_bracket');
    expect(linkRefusal({ ...club, format: 'match_net' }, comp())).toBe('not_golf_bracket');
    expect(linkRefusal({ ...club, format: 'stroke_net' }, comp())).toBeNull();
    expect(eligibleCompetition({ ...club, format: 'match_gross' }, comp())).toBe(false);
    expect(linkRefusal({ ...club, status: 'live' }, comp())).toBe('event_over');
    expect(linkRefusal(club, null)).toBe('not_found');
    expect(linkRefusal(club, comp({ org_id: 'c2' }))).toBe('other_org');
    expect(linkRefusal({ org_id: 'l1', status: 'open' }, comp({ org_id: 'l2', org: { kind: 'league' } }))).toBe('other_org');
    expect(linkRefusal(club, comp({ format: 'fixture' }))).toBe('not_golf_leaderboard');
    expect(linkRefusal(club, comp({ sport_key: 'ice_hockey' }))).toBe('not_golf_leaderboard');
    expect(linkRefusal(club, comp({ entrant_type: 'team' }))).toBe('not_athletes');
    expect(linkRefusal(club, comp({ status: 'completed' }))).toBe('competition_closed');
    for (const key of ['no_org', 'not_stroke_play', 'not_found', 'other_org', 'not_golf_leaderboard', 'not_athletes', 'competition_closed', 'event_over', 'results_exist', 'shape_mismatch', 'not_a_game', 'not_two_sided', 'already_linked', 'contest_over', 'sport_unsupported', 'side_size', 'points_format', 'not_a_bracket', 'not_golf_bracket', 'bracket_shape', 'bracket_not_drawn'] as const) expect(LINK_REFUSAL_COPY[key]).toBeTruthy();
  });
});

describe('contestRowFor + eventOrg', () => {
  it('mints a one-day window on the round\'s date with its holes, named "Round n" or by the round\'s own name', () => {
    expect(contestRowFor({ id: 'r2', sequence: 2, scheduled_on: '2030-06-02', holes: 18, name: null }, 'k1', 'v1')).toEqual({ competition_id: 'k1', sport_event_round_id: 'r2', round: 'Round 2', holes: 18, play_from: '2030-06-02', play_to: '2030-06-02', status: 'scheduled', venue_id: 'v1', scheduled_at: null });
    expect(contestRowFor({ id: 'r1', sequence: 1, scheduled_on: '2030-06-01', holes: 9, name: ' Saturday ' }, 'k1', null).round).toBe('Saturday');
    // Round 5 D0-b: the row carries org_id + the organizations embed; the kind comes from it.
    expect(eventOrg({ org_id: 'c1', org: { kind: 'club' } })).toEqual({ side: 'club', id: 'c1' });
    expect(eventOrg({ org_id: 'l1', org: { kind: 'league' } })).toEqual({ side: 'league', id: 'l1' });
    expect(eventOrg({ org_id: null, org: null })).toBeNull();
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
    expect(competitionAcceptsShape(pickup(), 'match', 'ice_hockey')).toBe('not_golf_bracket');
    expect(linkRefusal({ ...game, status: 'live' }, pickup())).toBe('event_over');
    expect(linkRefusal(game, pickup({ status: 'archived' }))).toBe('competition_closed');
  });
  it('a game round mints a contest with its label and start, no venue, no golf columns', () => {
    expect(gameContestRowFor({ id: 'r1', sequence: 1, starts_at: '2030-06-01T19:30:00.000Z', name: ' Week 3 ' }, 'k1')).toEqual({ competition_id: 'k1', sport_event_round_id: 'r1', round: 'Week 3', status: 'scheduled', venue_id: null, scheduled_at: '2030-06-01T19:30:00.000Z' });
    expect(gameContestRowFor({ id: 'r1', sequence: 1 }, 'k1')).toMatchObject({ round: null, scheduled_at: null });
  });
});

describe('the bracket door (leftovers PR 7) — the shape table, the link gate, the plan by slot', () => {
  const bracket = (patch: Partial<CompetitionForLink> = {}) => comp({ format: 'bracket', entrant_type: 'athlete', ...patch });
  const matchEvent = { ...club, format: 'match_gross', bracket: true };
  it('a BRACKETED match event counts toward a golf bracket of athletes or ad-hoc pairs; a plain match event and a non-bracket target are refused by name', () => {
    expect(linkRefusal(matchEvent, bracket())).toBeNull();
    expect(linkRefusal(matchEvent, bracket({ entrant_type: 'ad_hoc_team' }))).toBeNull();
    expect(eligibleCompetition(matchEvent, bracket())).toBe(true);
    expect(linkRefusal({ ...club, format: 'match_gross', bracket: false }, bracket())).toBe('not_a_bracket');
    expect(linkRefusal(matchEvent, comp())).toBe('not_golf_bracket');
    expect(linkRefusal(matchEvent, bracket({ sport_key: 'ice_hockey', format: 'bracket', entrant_type: 'team' }))).toBe('not_golf_bracket');
    expect(linkRefusal({ ...matchEvent, status: 'live' }, bracket())).toBe('event_over');
    expect(linkRefusal(matchEvent, bracket({ status: 'completed' }))).toBe('competition_closed');
  });
  it('the gate: undrawn, a stage count off the round count, or fine; the slot rule is identity', () => {
    expect(bracketShapeRefusal(0, 2)).toBe('bracket_not_drawn');
    expect(bracketShapeRefusal(3, 2)).toBe('bracket_shape');
    expect(bracketShapeRefusal(2, 2)).toBeNull();
    expect(slotForMatch({ sequence: 2 }, { sequence: 3 })).toEqual({ stage: 2, slot: 3 });
  });
  it('the plan: stamp, no slot, a result, another match, the same match; the sides agree either way round', () => {
    const matches = [
      { matchId: 'm1', groupSequence: 1, sides: [['a'], ['d']] as [string[], string[]] },
      { matchId: 'm2', groupSequence: 2, sides: [['b'], ['c']] as [string[], string[]] },
      { matchId: 'm3', groupSequence: 3, sides: [['x'], ['y']] as [string[], string[]] },
      { matchId: 'm4', groupSequence: 4, sides: [['p'], ['q']] as [string[], string[]] },
      { matchId: 'm5', groupSequence: 5, sides: [['r'], ['s']] as [string[], string[]] },
    ];
    const contests = [
      { id: 'c1', stage: 1, slot: 1, linkedMatchId: null, hasResult: false, home: ['a'], away: ['d'] },
      { id: 'c2', stage: 1, slot: 2, linkedMatchId: null, hasResult: false, home: ['c'], away: ['b'] },
      { id: 'c4', stage: 1, slot: 4, linkedMatchId: null, hasResult: true, home: ['p'], away: ['q'] },
      { id: 'c5', stage: 1, slot: 5, linkedMatchId: 'other', hasResult: false, home: ['r'], away: ['s'] },
      { id: 'c6', stage: 2, slot: 1, linkedMatchId: null, hasResult: false, home: null, away: null },
    ];
    const plan = matchLinkPlan(matches, contests, 1);
    expect(plan.map(op => [op.matchId, op.action, 'reason' in op ? op.reason : op.sidesAgree])).toEqual([['m1', 'stamp', true], ['m2', 'stamp', true], ['m3', 'skip', 'no_slot'], ['m4', 'skip', 'has_result'], ['m5', 'skip', 'already_linked']]);
    expect(matchLinkPlan([matches[0]], [{ ...contests[0], linkedMatchId: 'm1' }], 1)[0]).toMatchObject({ action: 'skip', reason: 'already' });
    expect(sidesAgree([['a', 'b'], ['c', 'd']], ['d', 'c'], ['b', 'a'])).toBe(true);
    expect(sidesAgree([['a'], ['c']], ['a'], ['x'])).toBe(false);
    expect(sidesAgree([['a'], ['c']], null, ['c'])).toBe(false);
  });
});
