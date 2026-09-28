import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TeamScheduleItem } from '@/lib/teams/schedule';
import { LIVE_FEED_MAX_GAMES, POLL_LIVE_MS, POLL_SOON_MS, idleFeed, projectLiveFeed } from '../live-feed';

// V1 (sports-team website program, Sep 28 2026): the public live feed.

const NOW = Date.parse('2026-10-03T19:00:00Z');
const item = (over: Partial<TeamScheduleItem>): TeamScheduleItem => ({
  kind: 'event', key: 'event:e1', when: '2026-10-03T18:30:00Z', allDay: false, timezone: null, title: 'Hawks vs Storm', opponent: null,
  location: 'Rivalry night', href: 'https://app.example/events/e1', state: 'live', result: null,
  pair: { home: 'Hawks', away: 'Storm', homeScore: 2, awayScore: 1 }, teamIds: ['t1', 't2'], ...over,
});

describe('projectLiveFeed', () => {
  it('a live game: its score, polled every 15 s; the feed carries names and links only', () => {
    const feed = projectLiveFeed({ upcoming: [item({})], results: [] }, NOW);
    expect(feed.pollMs).toBe(POLL_LIVE_MS);
    expect(feed.games).toEqual([{ id: 'event:e1', state: 'live', home: { name: 'Hawks', score: 2 }, away: { name: 'Storm', score: 1 }, title: 'Hawks vs Storm', startsAt: '2026-10-03T18:30:00Z', href: 'https://app.example/events/e1' }]);
    // Never the team ids, the location string or anything else from the item.
    expect(JSON.stringify(feed)).not.toMatch(/t1|t2|teamIds|location|Rivalry/);
  });

  it('starting within 2 h → 60 s; later or practice-only → idle (0); a calendar row is never a game', () => {
    const soon = item({ key: 'contest:c1', state: 'upcoming', when: '2026-10-03T20:30:00Z', pair: { home: 'A', away: 'B', homeScore: null, awayScore: null } });
    expect(projectLiveFeed({ upcoming: [soon], results: [] }, NOW).pollMs).toBe(POLL_SOON_MS);
    const later = { ...soon, when: '2026-10-04T12:00:00Z' };
    expect(projectLiveFeed({ upcoming: [later], results: [] }, NOW)).toMatchObject({ pollMs: 0, games: [] });
    const practice = item({ kind: 'calendar', key: 'calendar:p', state: 'upcoming', when: '2026-10-03T19:30:00Z' });
    expect(projectLiveFeed({ upcoming: [practice], results: [] }, NOW).games).toEqual([]);
  });

  it('a just-finished game stays on the feed (the card flips to Final) — an old one does not', () => {
    const fresh = item({ key: 'event:f', state: 'final', when: '2026-10-03T16:00:00Z' });
    const old = item({ key: 'event:o', state: 'final', when: '2026-10-02T16:00:00Z' });
    const feed = projectLiveFeed({ upcoming: [], results: [fresh, old] }, NOW);
    expect(feed.games.map(g => g.id)).toEqual(['event:f']);
    expect(feed.pollMs).toBe(0);
  });

  it('bounded: at most six games, live first', () => {
    const many = Array.from({ length: 9 }, (_, i) => item({ key: `event:${i}` }));
    const feed = projectLiveFeed({ upcoming: many, results: [] }, NOW);
    expect(feed.games).toHaveLength(LIVE_FEED_MAX_GAMES);
  });

  it('the idle feed stops every card', () => {
    expect(idleFeed(NOW)).toEqual({ v: 1, at: new Date(NOW).toISOString(), pollMs: 0, games: [] });
  });
});

describe('the live route', () => {
  const src = readFileSync(join(process.cwd(), 'src/app/api/public/org-sites/[slug]/live/route.ts'), 'utf8');
  it('never reads a session, a cookie or a header (the edge caches one copy for everyone)', () => {
    expect(src).not.toMatch(/requireAuth|getServerAuth|cookies\(|headers\(\)|request\.headers|next\/headers/);
    const server = readFileSync(join(process.cwd(), 'src/lib/org-sites/live-feed-server.ts'), 'utf8');
    expect(server).not.toMatch(/requireAuth|getServerAuth|cookies\(|headers\(\)|next\/headers/);
  });
  it('refuses a query string; every non-200 is no-store; the 200 is edge-cached 10 s', () => {
    expect(src).toContain('if (request.nextUrl.search) return');
    expect(src).toContain("'public, max-age=5, s-maxage=10, stale-while-revalidate=10'");
    for (const m of src.matchAll(/status: (4|5)\d\d, headers: (\w+)/g)) expect(m[2]).toBe('NO_STORE');
  });
});
