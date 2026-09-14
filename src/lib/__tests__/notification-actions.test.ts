import { describe, expect, it } from 'vitest';
import { actionRowFor, decidedText } from '../notification-actions';

describe('the bell action row', () => {
  it('shows for a pending actionable type only', () => {
    expect(actionRowFor({ type: 'sport_event_invite', title: 't', action_status: 'pending' })).toEqual({ show: true, accept: 'Accept', decline: 'Decline' });
    expect(actionRowFor({ type: 'follow_request', title: 't', action_status: 'pending' }).show).toBe(true);
    expect(actionRowFor({ type: 'sport_event_invite', title: 't', action_status: 'accepted' }).show).toBe(false);
    expect(actionRowFor({ type: 'sport_event_results', title: 't', action_status: 'pending' }).show).toBe(false);
    expect(actionRowFor({ type: 'sport_event_invite', title: 't' }).show).toBe(false);
  });
  it('a decided sport-event bell names the event; other types keep their title', () => {
    expect(decidedText({ type: 'sport_event_invite', title: 't', action_status: 'accepted', metadata: { sport_event_name: 'Spring Open' } }, 'Ann')).toBe('You accepted the invitation to Spring Open');
    expect(decidedText({ type: 'sport_event_request', title: 't', action_status: 'declined', metadata: {} }, 'Ann')).toBe("You declined Ann's request to join the event");
    expect(decidedText({ type: 'sport_event_invite', title: 't', action_status: 'pending' }, 'Ann')).toBeNull();
    expect(decidedText({ type: 'follow_request', title: 't', action_status: 'accepted' }, 'Ann')).toBeNull();
  });
});
