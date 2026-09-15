import { describe, expect, it } from 'vitest';
import { announcePostRow, groupPostRow, participantRows, postVisibilityFor, roundTitle, scorecardRow } from '../mint';
import type { SportEventRoundRow, SportEventRow } from '../types';

const event: SportEventRow = {
  id: 'e1', host_profile_id: 'host', created_by_user_id: 'guardian', club_id: null, league_id: null, sport_key: 'golf', name: 'Spring Open', description: 'Bring a friend', cover_path: null,
  join_mode: 'invite', visibility: 'private', link_token: null, format: 'stroke_net', status: 'open', capacity: null, starts_on: '2026-10-03',
  opened_at: null, went_live_at: null, completed_at: null, cancelled_at: null, created_at: 'c', updated_at: 'u',
};
const round: SportEventRoundRow = {
  id: 'r1', sport_event_id: 'e1', sequence: 1, scheduled_on: '2026-10-03', course_id: 'course', course_name: 'Eagle Creek', tee: 'Blue', holes: 9, starting_hole: 10,
  course_rating: 35.6, slope_rating: 128, hole_data: [{ hole: 10, par: 4, yardage: 400, handicap: 8 }, { hole: 11, par: 3, yardage: null, handicap: null }], status: 'scheduled', created_at: 'c', updated_at: 'u',
};

describe('the mint rows', () => {
  it('the announce post: the host is the author, the guardian the byline, private outside a public event, the round link + stats_data marker', () => {
    const row = announcePostRow(event, round);
    expect(row).toMatchObject({ profile_id: 'host', created_by_user_id: 'guardian', sport_key: 'golf', visibility: 'private', sport_event_round_id: 'r1', stats_data: { type: 'sport_event_announce', sport_event_id: 'e1', sport_event_round_id: 'r1' } });
    expect(row.caption).toBe('Spring Open · Eagle Creek · 2026-10-03\nBring a friend');
    expect(announcePostRow({ ...event, created_by_user_id: 'host', visibility: 'public' }, round)).not.toHaveProperty('created_by_user_id');
    expect(postVisibilityFor({ visibility: 'link' })).toBe('private');
  });
  it('the group_post: the host is the creator, pending, participants_only, dated the organizer\'s day, titled per round count', () => {
    expect(groupPostRow(event, round, { roundCount: 1, date: '2026-10-04' })).toEqual({ creator_id: 'host', type: 'golf_round', title: 'Spring Open', description: 'Bring a friend', date: '2026-10-04', location: 'Eagle Creek', visibility: 'participants_only', status: 'pending', sport_event_round_id: 'r1' });
    expect(roundTitle(event, round, 3)).toBe('Spring Open — Round 1');
  });
  it('the scorecard keeps the stroke index and drops an empty yardage', () => {
    const card = scorecardRow(round, 'gp');
    expect(card).toMatchObject({ group_post_id: 'gp', course_id: 'course', round_type: 'outdoor', game_format: 'stroke', holes_played: 9, tee_color: 'Blue', slope_rating: 128, course_rating: 35.6 });
    expect(card.hole_data).toEqual([{ hole: 10, par: 4, yardage: 400, handicap: 8 }, { hole: 11, par: 3 }]);
    expect(scorecardRow({ ...round, hole_data: null }, 'gp').hole_data).toBeNull();
    expect(scorecardRow(round, 'gp', 'match').game_format).toBe('match'); // phase 3: a match round's card (032's CHECK admits it)
  });
  it('participant rows carry the plan order and are confirmed at mint', () => {
    const rows = participantRows({ groupPost: { type: 'golf_round', visibility: 'public' }, participantRows: [{ profile_id: 'host', role: 'creator', status: 'confirmed', position: 1 }, { profile_id: 'b', role: 'participant', status: 'confirmed', position: 2 }] }, 'gp', 'now');
    expect(rows).toEqual([{ group_post_id: 'gp', profile_id: 'host', role: 'creator', status: 'confirmed', attested_at: 'now', position: 1 }, { group_post_id: 'gp', profile_id: 'b', role: 'participant', status: 'confirmed', attested_at: 'now', position: 2 }]);
  });
});
