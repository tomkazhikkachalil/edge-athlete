import { describe, expect, it } from 'vitest';
import { liveEventCards, liveRoundOf, mayOpen, type LiveEventRow } from '../live-now';

const round = (id: string, sequence: number, status: string, group_post_id: string | null = 'gp'): LiveEventRow['rounds'][number] => ({ id, sequence, name: null, status, course_name: 'Links', scheduled_on: '2030-06-01', group_post_id });
const row = (over: Partial<LiveEventRow> = {}): LiveEventRow => ({ id: 'e1', name: 'Cup', sport_key: 'golf', format: 'stroke_gross', visibility: 'public', status: 'live', rounds: [round('r1', 1, 'live')], playing: 4, followers: 2, viewer_status: null, ...over });

describe('Live Now for events (phase 4)', () => {
  it('a public live event is a card for anyone; a private one only for its own accepted viewer; a non-live event or one with no live round is none', () => {
    expect(liveEventCards([row()])).toMatchObject([{ id: 'e1', href: '/events/e1?tab=leaderboard&round=r1', playing: 4, round: { round_count: 1 } }]);
    expect(liveEventCards([row({ visibility: 'private' })])).toEqual([]);
    expect(liveEventCards([row({ visibility: 'private', viewer_status: 'accepted' })])).toHaveLength(1);
    expect(liveEventCards([row({ status: 'open', rounds: [round('r1', 1, 'scheduled', null)] })])).toEqual([]);
    expect(liveEventCards([row({ rounds: [round('r1', 1, 'completed')] })])).toEqual([]);
    expect(mayOpen({ visibility: 'link', viewer_status: null })).toBe(false);
    expect(liveRoundOf([round('r1', 1, 'completed'), round('r2', 2, 'live')])?.id).toBe('r2');
  });
  it('a tournament names the live round and counts the non-cancelled rounds; match play lands on the matches; cards sort by name', () => {
    const t = row({ id: 'e2', name: 'Bracket', format: 'match_gross', rounds: [round('r1', 1, 'completed'), round('r2', 2, 'live'), round('r3', 3, 'cancelled')] });
    expect(liveEventCards([t, row()]).map(c => [c.id, c.href, c.round.round_count])).toEqual([['e2', '/events/e2?tab=matches&round=r2', 2], ['e1', '/events/e1?tab=leaderboard&round=r1', 1]]);
  });
});
