import { describe, expect, it } from 'vitest';
import { bellCopy, eventPath } from '../notify';

describe('the sport_event_* bell copy', () => {
  const ctx = { eventId: 'e1', eventName: 'Spring Open', actorName: 'Alex Rivera' };
  it('every line names the event and lands on the right tab', () => {
    expect(bellCopy('invite', ctx)).toEqual({ type: 'sport_event_invite', title: 'Alex Rivera invited you to Spring Open', message: 'Accept to play, or decline.', action_url: '/events/e1?tab=players' });
    expect(bellCopy('request', ctx)).toMatchObject({ type: 'sport_event_request', title: 'Alex Rivera asked to join Spring Open', action_url: '/events/e1?tab=players' });
    expect(bellCopy('approved', ctx)).toMatchObject({ type: 'sport_event_request_decision', title: "You're in: Spring Open", action_url: '/events/e1' });
    expect(bellCopy('rejected', ctx)).toMatchObject({ type: 'sport_event_request_decision', title: 'Not this time: Spring Open' });
    expect(bellCopy('promoted', ctx)).toMatchObject({ type: 'sport_event_request_decision', title: 'A spot opened up: Spring Open' });
    expect(eventPath('e1', 'leaderboard')).toBe('/events/e1?tab=leaderboard');
  });
});
