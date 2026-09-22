import { describe, expect, it } from 'vitest';
import { StatLinePostAdapter } from '../adapters/StatLinePostAdapter';
import { GolfAdapter } from '../adapters/GolfAdapter';

// Round 4: every stat-line sport has the golfer's two doors — its log and
// its trends — from the adapter, so no page special-cases a sport. Golf
// keeps its own routes.

describe('StatLinePostAdapter.getNavLinks', () => {
  it('points at the generic log and trends pages, worded in the sport\'s noun', () => {
    expect(new StatLinePostAdapter('ice_hockey').getNavLinks()).toEqual([
      { href: '/app/sport/ice_hockey/log', label: 'View all games →' },
      { href: '/app/sport/ice_hockey/trends', label: 'Trends →' },
    ]);
    expect(new StatLinePostAdapter('volleyball').getNavLinks()[0].label).toBe('View all matches →');
    expect(new StatLinePostAdapter('track_field').getNavLinks()[0].label).toBe('View all races →');
  });
  it('golf keeps its own routes', () => {
    expect(new GolfAdapter().getNavLinks().map(l => l.href)).toEqual(['/app/sport/golf/rounds', '/app/sport/golf/trends']);
  });
});
