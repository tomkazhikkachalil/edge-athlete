import { describe, expect, it } from 'vitest';
import { applyRoundCounts, labelsWantingMatchResults, matchResultsFor, postEventState, roundLabelOf, sportEventIdsOf, sportEventLabelsByRound } from '../feed';

describe('the event beside a post', () => {
  it('flattens the round + event rows and skips a round without its event', () => {
    const m = sportEventLabelsByRound([
      { id: 'r1', scheduled_on: '2030-06-01', course_name: 'Eagle', holes: 9, starting_hole: 10, event: { id: 'e1', name: 'Open', status: 'open', join_mode: 'request', visibility: 'public', host_profile_id: 'h' } },
      { id: 'r2', scheduled_on: '2030-06-02', course_name: 'X', holes: 18, starting_hole: 1, event: null },
    ]);
    expect(m.get('r1')).toMatchObject({ id: 'e1', name: 'Open', round_id: 'r1', holes: 9, starting_hole: 10, sequence: 1, round_status: 'scheduled', round_count: 1, round_name: null, format: 'stroke_gross', match: null });
    expect(m.has('r2')).toBe(false);
  });
  it('phase 2: the round count from one grouped read; "Round n of m" only on a tournament', () => {
    const m = sportEventLabelsByRound([
      { id: 'r1', sequence: 1, status: 'completed', scheduled_on: '2030-06-01', course_name: 'Eagle', holes: 18, starting_hole: 1, event: { id: 'e1', name: 'Open', status: 'live', join_mode: 'invite', visibility: 'private', host_profile_id: 'h' } },
      { id: 'r2', sequence: 2, status: 'live', scheduled_on: '2030-06-02', course_name: 'Eagle', holes: 18, starting_hole: 1, event: { id: 'e1', name: 'Open', status: 'live', join_mode: 'invite', visibility: 'private', host_profile_id: 'h' } },
      { id: 'r9', sequence: 1, status: 'scheduled', scheduled_on: '2030-07-01', course_name: 'X', holes: 9, starting_hole: 1, event: { id: 'e2', name: 'Solo', status: 'open', join_mode: 'invite', visibility: 'private', host_profile_id: 'h' } },
    ]);
    expect(sportEventIdsOf(m)).toEqual(['e1', 'e2']);
    applyRoundCounts(m, [{ sport_event_id: 'e1' }, { sport_event_id: 'e1' }, { sport_event_id: 'e1' }]);
    expect(m.get('r2')!.round_count).toBe(3);
    expect(m.get('r9')!.round_count).toBe(1); // no row → 1, never 0
    expect(roundLabelOf(m.get('r2')!)).toBe('Round 2 of 3');
    expect(roundLabelOf(m.get('r9')!)).toBeNull();
  });
  it("phase 2: the state is the ROUND's — a round-2 post is announced while round 1 is live", () => {
    expect(postEventState({ status: 'live', round_status: 'scheduled' }, false)).toBe('announced');
    expect(postEventState({ status: 'live', round_status: 'live' }, false)).toBe('live');
    expect(postEventState({ status: 'live', round_status: 'completed' }, true)).toBe('results');
    expect(postEventState({ status: 'live', round_status: 'completed' }, false)).toBe('results');
    expect(postEventState({ status: 'open', round_status: 'cancelled' }, false)).toBe('cancelled');
  });
  it('phase 3: the round name, the format and the match options ride the label; the results lines name the winner first; only completed match rounds want results', () => {
    const m = sportEventLabelsByRound([
      { id: 'r1', sequence: 2, status: 'completed', name: 'Final', scheduled_on: '2030-06-01', course_name: 'Eagle', holes: 9, starting_hole: 1, event: { id: 'e1', name: 'Cup', status: 'completed', join_mode: 'invite', visibility: 'public', host_profile_id: 'h', format: 'match_net', format_config: { match: { sides: 'fourball', bracket: true } } } },
      { id: 'r2', sequence: 1, status: 'live', scheduled_on: '2030-06-01', course_name: 'Eagle', holes: 9, starting_hole: 1, event: { id: 'e2', name: 'Singles', status: 'live', join_mode: 'invite', visibility: 'public', host_profile_id: 'h', format: 'match_gross' } },
      { id: 'r3', sequence: 1, status: 'completed', scheduled_on: '2030-06-01', course_name: 'Eagle', holes: 9, starting_hole: 1, event: { id: 'e3', name: 'Stroke', status: 'completed', join_mode: 'invite', visibility: 'public', host_profile_id: 'h', format: 'stroke_net' } },
    ]);
    expect(m.get('r1')).toMatchObject({ round_name: 'Final', format: 'match_net', match: { sides: 'fourball', bracket: true } });
    expect(m.get('r2')).toMatchObject({ round_name: null, format: 'match_gross', match: { sides: 'singles', bracket: false } });
    expect(m.get('r3')!.match).toBeNull();
    expect(labelsWantingMatchResults(m).map(e => e.round_id)).toEqual(['r1']);
    m.get('r1')!.match_results = [];
    expect(labelsWantingMatchResults(m)).toEqual([]);
    const side = (s: 1 | 2, names: string[]) => ({ side: s, members: names.map(n => ({ participant_id: n, profile_id: n, name: n, handle: null, avatar_url: null })), card_participant_ids: names });
    const st = (winnerSide: 1 | 2 | null, result: string | null, summary = 'All square thru 3') => ({ winnerSide, result, summary }) as unknown as Parameters<typeof matchResultsFor>[0][number]['state'];
    expect(matchResultsFor([
      { id: 'm1', title: 'Match 1', bye: false, sides: [side(1, ['Ann']), side(2, ['Bob'])], state: st(2, '3&2') },
      { id: 'm2', title: 'Match 2', bye: true, sides: [side(1, ['Cy', 'Di']), side(2, [])], state: st(1, 'bye') },
      { id: 'm3', title: 'Match 3', bye: false, sides: [side(1, ['Ed']), side(2, ['Flo'])], state: st(null, null) },
    ])).toEqual([
      { match_id: 'm1', title: 'Match 1', winner: 'Bob', loser: 'Ann', result: '3&2', kind: 'decided' },
      { match_id: 'm2', title: 'Match 2', winner: 'Cy & Di', loser: '', result: 'bye', kind: 'bye' },
      { match_id: 'm3', title: 'Match 3', winner: 'Ed', loser: 'Flo', result: 'All square thru 3', kind: 'open' },
    ]);
  });
  it('names the state the card leads with', () => {
    expect(postEventState({ status: 'open' }, false)).toBe('announced');
    expect(postEventState({ status: 'live' }, false)).toBe('live');
    expect(postEventState({ status: 'completed' }, true)).toBe('results');
    expect(postEventState({ status: 'completed' }, false)).toBe('results');
    expect(postEventState({ status: 'cancelled' }, false)).toBe('cancelled');
  });
});
