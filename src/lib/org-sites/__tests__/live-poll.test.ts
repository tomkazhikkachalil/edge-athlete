import { describe, expect, it } from 'vitest';
import { BACKOFF_MAX_MS, autoPollAllowed, gameIn, mergeFeed, nextDelay, watchGame } from '../live-poll';
import { liveGameOf, type LiveFeed } from '../live-feed';

// V2 (sports-team website program, Sep 28 2026): every rule that decides a
// request the live card makes.

const NOW = Date.parse('2026-10-03T19:00:00Z');
const feed = (at: string, games: LiveFeed['games'] = []): LiveFeed => ({ v: 1, at, pollMs: 15_000, games });

describe('watchGame', () => {
  it('a live game always; an upcoming one within 2 h before to 4 h after its start (the viewer’s clock); never a final or an undated game', () => {
    expect(watchGame({ state: 'live', startsAt: null }, NOW)).toBe(true);
    expect(watchGame({ state: 'upcoming', startsAt: '2026-10-03T20:30:00Z' }, NOW)).toBe(true);
    expect(watchGame({ state: 'upcoming', startsAt: '2026-10-03T16:00:00Z' }, NOW)).toBe(true); // started, not yet flipped live
    expect(watchGame({ state: 'upcoming', startsAt: '2026-10-03T22:00:00Z' }, NOW)).toBe(false);
    expect(watchGame({ state: 'upcoming', startsAt: '2026-10-03T13:00:00Z' }, NOW)).toBe(false);
    expect(watchGame({ state: 'final', startsAt: '2026-10-03T18:00:00Z' }, NOW)).toBe(false);
    expect(watchGame({ state: 'upcoming', startsAt: null }, NOW)).toBe(false);
  });
});

describe('nextDelay', () => {
  it('the server’s pollMs ±20 %; 0 stops; a failure backs off ×2 to a 5-minute cap', () => {
    expect(nextDelay(15_000, 0, 0)).toBe(12_000);
    expect(nextDelay(15_000, 0, 0.999)).toBeLessThanOrEqual(18_000);
    expect(nextDelay(0, 0, 0.5)).toBeNull();
    expect(nextDelay(0, 1, 0.5)).toBe(15_000);
    expect(nextDelay(0, 2, 0.5)).toBe(30_000);
    expect(nextDelay(0, 20, 0.999)).toBeLessThanOrEqual(BACKOFF_MAX_MS * 1.2);
    expect(nextDelay(0, 20, 0)).toBe(BACKOFF_MAX_MS * 0.8);
  });
});

describe('mergeFeed', () => {
  it('never adopts an older feed — a stale edge copy cannot roll a score back', () => {
    const newer = feed('2026-10-03T19:00:10Z');
    const older = feed('2026-10-03T19:00:00Z');
    expect(mergeFeed(null, older)).toBe(older);
    expect(mergeFeed(newer, older)).toBe(newer);
    expect(mergeFeed(older, newer)).toBe(newer);
  });
});

describe('autoPollAllowed + gameIn + the first render', () => {
  it('Save-Data or reduced-data: no automatic requests', () => {
    expect(autoPollAllowed({})).toBe(true);
    expect(autoPollAllowed({ saveData: true })).toBe(false);
    expect(autoPollAllowed({ reducedData: true })).toBe(false);
  });
  it('the card finds its game by key; a game gone from the feed keeps the card’s last copy (null)', () => {
    const g = liveGameOf({ kind: 'event', key: 'event:e1', when: '2026-10-03T18:30:00Z', allDay: false, timezone: null, title: 'A vs B', opponent: null, location: null, href: null, state: 'live', result: null, pair: { home: 'A', away: 'B', homeScore: 1, awayScore: 0 } });
    expect(g).toEqual({ id: 'event:e1', state: 'live', home: { name: 'A', score: 1 }, away: { name: 'B', score: 0 }, title: 'A vs B', startsAt: '2026-10-03T18:30:00Z', href: null });
    expect(gameIn(feed('2026-10-03T19:00:00Z', [g]), 'event:e1')).toEqual(g);
    expect(gameIn(feed('2026-10-03T19:00:00Z', []), 'event:e1')).toBeNull();
  });
});
