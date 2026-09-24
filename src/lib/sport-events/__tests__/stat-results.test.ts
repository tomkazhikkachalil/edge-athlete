import { describe, expect, it } from 'vitest';
import { isSportEventResultsData, lineHasStats, provenanceForLine, resultsPostData, statLinePostCaption, statLinePostData, statLinePostRow } from '../stat-results';

const event = { id: 'e1', name: 'Friday skate', sport_key: 'ice_hockey', visibility: 'public' as const, org_id: null, org: null, host_profile_id: 'h', created_by_user_id: null };
const round = { id: 'r1', scheduled_on: '2030-06-01' };
const game = { score: { side1_score: 4, side2_score: 2, period: 3 }, sides: ['Reds', 'Blues'] as [string, string] };
const b = { id: 'l1', participant_id: 'pb', profile_id: 'B', stats: { goals: 2, assists: 1 }, side: 1 as const, name: 'Edge B.', entered_by: 'B' };
const c = { id: 'l2', participant_id: 'pc', profile_id: 'C', stats: { goals: 1 }, side: 2 as const, name: 'Edge C.', entered_by: 'A' };
const d = { id: 'l3', participant_id: 'pd', profile_id: 'D', stats: {}, side: 2 as const, name: 'Edge D.', entered_by: null };

describe('a line\'s results post — the existing stat_line shape, found again by the line id', () => {
  it('a game: the opponent is the other side, the result and score from the player\'s side', () => {
    expect(statLinePostData(event, round, b, game)).toEqual({ type: 'stat_line', sport_key: 'ice_hockey', date: '2030-06-01', stats: { goals: 2, assists: 1 }, opponent: 'Blues', result: 'W', result_score: '4-2', sport_event_id: 'e1', sport_event_round_id: 'r1', sport_event_stat_line_id: 'l1' });
    expect(statLinePostData(event, round, c, game)).toMatchObject({ opponent: 'Reds', result: 'L', result_score: '2-4' });
    // A session: the opponent is the event; no result.
    expect(statLinePostData(event, round, { ...b, side: null }, null)).toMatchObject({ opponent: 'Friday skate' });
    expect(statLinePostData(event, round, { ...b, side: null }, null)).not.toHaveProperty('result');
    // A game with no score yet: no result, no score.
    expect(statLinePostData(event, round, b, { ...game, score: { side1_score: null, side2_score: null, period: null } })).not.toHaveProperty('result');
  });
  it('the post row: the player is the author, public inside a public event, the caption names the event and the day; the guardian when one hosts', () => {
    const row = statLinePostRow(event, round, b, game, null);
    expect(row).toMatchObject({ profile_id: 'B', sport_key: 'ice_hockey', visibility: 'public', caption: 'Friday skate · 2030-06-01', tags: [], likes_count: 0 });
    expect(row).not.toHaveProperty('created_by_user_id');
    expect(statLinePostRow({ ...event, visibility: 'private' }, round, b, game, 'guardian-user')).toMatchObject({ visibility: 'private', created_by_user_id: 'guardian-user' });
    expect(statLinePostCaption(event, round)).toBe('Friday skate · 2030-06-01');
  });
  it('lineHasStats: an untouched line is not a game played', () => {
    expect(lineHasStats({})).toBe(false);
    expect(lineHasStats({ goals: 0 })).toBe(false);
    expect(lineHasStats({ goals: 1 })).toBe(true);
  });
  it('provenance: an org-hosted event\'s recorder / organizer entry is the org\'s; a player\'s own, or an athlete-run event, is self-reported', () => {
    expect(provenanceForLine(event, b)).toBe('self_reported');
    expect(provenanceForLine({ ...event, org_id: 'club', org: { kind: 'club' } }, c)).toBe('club_recorded');
    expect(provenanceForLine({ ...event, org_id: 'lg', org: { kind: 'league' } }, c)).toBe('league_verified');
    expect(provenanceForLine({ ...event, org_id: 'lg', org: { kind: 'league' } }, b)).toBe('self_reported');
    expect(provenanceForLine({ ...event, org_id: 'club', org: { kind: 'club' } }, d)).toBe('self_reported');
  });
});

describe('the round\'s ONE post at completion', () => {
  it('a game: the score, each side\'s players with their headline, the top lines by the hero value', () => {
    const r = resultsPostData(event, round, 'game', [b, c, d], game);
    expect(isSportEventResultsData(r)).toBe(true);
    expect(r).toMatchObject({ type: 'sport_event_results', shape: 'game', score: { side1_score: 4, side2_score: 2, period: 3 } });
    expect(r.sides.map(s => s.name)).toEqual(['Reds', 'Blues']);
    expect(r.sides[1].players.map(p => p.name)).toEqual(['Edge C.', 'Edge D.']);
    expect(r.sides[0].players[0].headline).toMatch(/2 G/);
    expect(r.top.map(t => t.name)).toEqual(['Edge B.', 'Edge C.']); // D entered nothing
  });
  it('a session: no score, no sides, the top three', () => {
    const r = resultsPostData(event, round, 'session', [{ ...b, side: null }, { ...c, side: null }], null);
    expect(r.score).toBeNull();
    expect(r.sides).toEqual([]);
    expect(r.top).toHaveLength(2);
    expect(isSportEventResultsData({ type: 'stat_line' })).toBe(false);
  });
});
