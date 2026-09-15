import { describe, expect, it } from 'vitest';
import { activeNavPath } from '../nav-active';

describe('activeNavPath — the one active rule for the header and the tab bar', () => {
  it('lights Feed only on /feed, Profile on /athlete/*, Live on /live/*, Sports on /sports/* and an event page', () => {
    expect(activeNavPath('/feed', '/feed')).toBe(true);
    expect(activeNavPath('/feed?create=1', '/feed')).toBe(false);
    expect(activeNavPath('/athlete/abc', '/athlete')).toBe(true);
    expect(activeNavPath('/u/tom', '/athlete')).toBe(false);
    expect(activeNavPath('/live/gp1', '/live')).toBe(true);
    expect(activeNavPath('/sports/leaderboards', '/sports')).toBe(true);
    expect(activeNavPath('/events/e1', '/sports')).toBe(true);
    expect(activeNavPath('/calendar', '/calendar')).toBe(true);
    expect(activeNavPath('/calendar/week', '/calendar')).toBe(false);
  });
  it('is a strict boolean, never undefined, and false without a pathname', () => {
    expect(activeNavPath(null, '/feed')).toBe(false);
    expect(activeNavPath(undefined, '/athlete')).toBe(false);
    expect(activeNavPath('/messages', '/messages')).toBe(true);
    expect(activeNavPath('/messages/c1', '/messages')).toBe(true);
  });
});
