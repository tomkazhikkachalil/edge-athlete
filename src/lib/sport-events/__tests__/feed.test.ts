import { describe, expect, it } from 'vitest';
import { applyRoundCounts, postEventState, roundLabelOf, sportEventIdsOf, sportEventLabelsByRound } from '../feed';

describe('the event beside a post', () => {
  it('flattens the round + event rows and skips a round without its event', () => {
    const m = sportEventLabelsByRound([
      { id: 'r1', scheduled_on: '2030-06-01', course_name: 'Eagle', holes: 9, starting_hole: 10, event: { id: 'e1', name: 'Open', status: 'open', join_mode: 'request', visibility: 'public', host_profile_id: 'h' } },
      { id: 'r2', scheduled_on: '2030-06-02', course_name: 'X', holes: 18, starting_hole: 1, event: null },
    ]);
    expect(m.get('r1')).toMatchObject({ id: 'e1', name: 'Open', round_id: 'r1', holes: 9, starting_hole: 10, sequence: 1, round_status: 'scheduled', round_count: 1 });
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
  it('names the state the card leads with', () => {
    expect(postEventState({ status: 'open' }, false)).toBe('announced');
    expect(postEventState({ status: 'live' }, false)).toBe('live');
    expect(postEventState({ status: 'completed' }, true)).toBe('results');
    expect(postEventState({ status: 'completed' }, false)).toBe('results');
    expect(postEventState({ status: 'cancelled' }, false)).toBe('cancelled');
  });
});
