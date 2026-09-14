import { describe, expect, it } from 'vitest';
import { activeSportsSection, isSportsPath, parseEventsFilter, SPORTS_SECTIONS } from '../sports-nav';

describe('the Sports section', () => {
  it('has the three places in order', () => {
    expect(SPORTS_SECTIONS.map(s => s.path)).toEqual(['/sports/explore', '/sports/events', '/sports/leaderboards']);
  });
  it('resolves the active section; an event page is Events; /sports is Explore', () => {
    expect(activeSportsSection('/sports/explore')).toBe('explore');
    expect(activeSportsSection('/sports/events/new')).toBe('events');
    expect(activeSportsSection('/events/abc')).toBe('events');
    expect(activeSportsSection('/sports')).toBe('explore');
    expect(activeSportsSection('/event/abc')).toBeNull(); // the contest place is the org's
    expect(activeSportsSection('/feed')).toBeNull();
    expect(isSportsPath('/sports/leaderboards')).toBe(true);
    expect(isSportsPath(null)).toBe(false);
  });
  it('the events filter defaults to upcoming', () => {
    expect(parseEventsFilter('live')).toBe('live');
    expect(parseEventsFilter('x')).toBe('upcoming');
  });
});
