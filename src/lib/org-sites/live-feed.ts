// ── The public live-scores feed — the PROJECTION (sports-team website
// program, V1, Sep 28 2026). Pure, client-safe (the island reads the type).
//
// What a site's scoreboard polls: the games being played now, the ones
// about to start, and the ones that just finished (so a live card can flip
// to "Final" without a reload). The names are the ones the ISR pages
// already print — `fetchOrgGames`' home-first sides (team names, or a
// person's MASKED name through the one name rule) — never an id beyond the
// game key and its public link, never an email or a profile. `pollMs` is
// the server's word on how often to ask again: live → 15 s, starting soon
// → 60 s, nothing happening → 0 (the island stops).

import type { TeamScheduleItem } from '@/lib/teams/schedule';

export const LIVE_FEED_VERSION = 1;
export const POLL_LIVE_MS = 15_000;
export const POLL_SOON_MS = 60_000;
/** "About to start": within two hours. */
export const SOON_WINDOW_MS = 2 * 3_600_000;
/** "Just finished": within six hours of its start. */
export const RECENT_FINAL_MS = 6 * 3_600_000;
export const LIVE_FEED_MAX_GAMES = 6;

export interface LiveFeedSide {
  name: string;
  score: number | null;
}

export interface LiveFeedGame {
  /** The game's key ("contest:<id>" | "event:<id>") — stable across polls. */
  id: string;
  state: 'upcoming' | 'live' | 'final';
  home: LiveFeedSide | null;
  away: LiveFeedSide | null;
  /** The line when the sides are unknown (a leaderboard, an unnamed side). */
  title: string;
  startsAt: string | null;
  href: string | null;
}

export interface LiveFeed {
  v: typeof LIVE_FEED_VERSION;
  /** When the server built it — the island never adopts an older feed. */
  at: string;
  pollMs: number;
  games: LiveFeedGame[];
}

const atMs = (when: string | null): number | null => {
  if (!when) return null;
  const t = Date.parse(when.length === 10 ? `${when}T12:00:00Z` : when);
  return Number.isFinite(t) ? t : null;
};

function toGame(i: TeamScheduleItem): LiveFeedGame {
  return {
    id: i.key,
    state: i.state,
    home: i.pair ? { name: i.pair.home, score: i.pair.homeScore } : null,
    away: i.pair ? { name: i.pair.away, score: i.pair.awayScore } : null,
    title: i.title,
    startsAt: i.when,
    href: i.href,
  };
}

export function projectLiveFeed(games: { upcoming: readonly TeamScheduleItem[]; results: readonly TeamScheduleItem[] }, nowMs: number): LiveFeed {
  const live = games.upcoming.filter(i => i.state === 'live' && i.kind !== 'calendar');
  const soon = games.upcoming.filter(i => {
    if (i.state !== 'upcoming' || i.kind === 'calendar') return false;
    const t = atMs(i.when);
    return t !== null && t >= nowMs - 30 * 60_000 && t - nowMs <= SOON_WINDOW_MS;
  });
  const recent = games.results.filter(i => {
    const t = atMs(i.when);
    return t !== null && nowMs - t <= RECENT_FINAL_MS && t <= nowMs;
  });
  const picked = [...live, ...soon, ...recent].slice(0, LIVE_FEED_MAX_GAMES).map(toGame);
  const pollMs = live.length > 0 ? POLL_LIVE_MS : soon.length > 0 ? POLL_SOON_MS : 0;
  return { v: LIVE_FEED_VERSION, at: new Date(nowMs).toISOString(), pollMs, games: picked };
}

/** An idle feed (the kill switch; a site with nothing on). */
export function idleFeed(nowMs: number): LiveFeed {
  return { v: LIVE_FEED_VERSION, at: new Date(nowMs).toISOString(), pollMs: 0, games: [] };
}
