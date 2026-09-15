import { describe, expect, it } from 'vitest';
import { showsTabBar, TAB_BAR_LINKS } from '../tab-bar';

describe('the phone tab bar', () => {
  it('has the five places in the header\'s order, Live in the middle', () => {
    expect(TAB_BAR_LINKS.map(l => l.key)).toEqual(['feed', 'sports', 'live', 'calendar', 'profile']);
    expect(TAB_BAR_LINKS.map(l => l.path)).toEqual(['/feed', '/sports', '/live', '/calendar', '/athlete']);
  });
  it('shows on the signed-in places', () => {
    for (const p of ['/feed', '/sports/explore', '/sports/events', '/events/e1', '/calendar', '/athlete/x', '/u/tom', '/app/profile', '/app/notifications', '/app/guardian', '/live', '/messages', '/league/l1', '/club/c1/standings', '/event/x', '/dashboard']) {
      expect(showsTabBar(p), p).toBe(true);
    }
  });
  it('hides on the screens that own their bottom edge and on the funnels', () => {
    for (const p of ['/live/gp1', '/messages/c1', '/sports/events/new', '/app/diag/media', '/app/transfer/p1', '/app/guardian/consent/p1', '/app/guardian/add-athlete', '/app/guardian/credentials/p1', '/', '/privacy', '/terms', '/onboarding', '/auth/complete-profile', '/invite/t', '/org/slug', '/reset-password']) {
      expect(showsTabBar(p), p).toBe(false);
    }
    expect(showsTabBar(null)).toBe(false);
    expect(showsTabBar('/feed/')).toBe(true);
  });
});
