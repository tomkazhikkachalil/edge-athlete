import { describe, expect, it } from 'vitest';
import { postEventState, sportEventLabelsByRound } from '../feed';

describe('the event beside a post', () => {
  it('flattens the round + event rows and skips a round without its event', () => {
    const m = sportEventLabelsByRound([
      { id: 'r1', scheduled_on: '2030-06-01', course_name: 'Eagle', holes: 9, starting_hole: 10, event: { id: 'e1', name: 'Open', status: 'open', join_mode: 'request', visibility: 'public', host_profile_id: 'h' } },
      { id: 'r2', scheduled_on: '2030-06-02', course_name: 'X', holes: 18, starting_hole: 1, event: null },
    ]);
    expect(m.get('r1')).toMatchObject({ id: 'e1', name: 'Open', round_id: 'r1', holes: 9, starting_hole: 10 });
    expect(m.has('r2')).toBe(false);
  });
  it('names the state the card leads with', () => {
    expect(postEventState({ status: 'open' }, false)).toBe('announced');
    expect(postEventState({ status: 'live' }, false)).toBe('live');
    expect(postEventState({ status: 'completed' }, true)).toBe('results');
    expect(postEventState({ status: 'completed' }, false)).toBe('results');
    expect(postEventState({ status: 'cancelled' }, false)).toBe('cancelled');
  });
});
