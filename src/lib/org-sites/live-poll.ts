// ── The live card's polling rules (sports-team website program, V2) ─────────
// Pure and ZERO-IMPORT except the feed's types: the client island
// (`src/components/site-live/`) is the only runtime caller, and every rule
// that decides a request is here, testable in node:
//   • watchGame — whether a card polls at all: only a game being played or
//     starting within two hours (read on the VIEWER's clock — the ISR copy
//     may be minutes old); a finished or far-off game never asks.
//   • nextDelay — the server's `pollMs`, jittered ±20 % so a crowd of
//     cards never ticks together; a failure backs off (×2 per failure,
//     capped at 5 min); `pollMs` 0 stops.
//   • mergeFeed — never adopt an OLDER feed (a stale edge copy must not
//     roll a score back): the newer `at` wins.
//   • autoPollAllowed — Save-Data or reduced-data means no automatic
//     requests: the card offers a Refresh button instead.

import type { LiveFeed, LiveFeedGame } from './live-feed';

export const WATCH_BEFORE_MS = 2 * 3_600_000;
export const WATCH_AFTER_MS = 4 * 3_600_000;
export const BACKOFF_BASE_MS = 15_000;
export const BACKOFF_MAX_MS = 5 * 60_000;
export const FIRST_POLL_MS = 1_500;

export function watchGame(game: Pick<LiveFeedGame, 'state' | 'startsAt'>, nowMs: number): boolean {
  if (game.state === 'live') return true;
  if (game.state !== 'upcoming' || !game.startsAt) return false;
  const t = Date.parse(game.startsAt.length === 10 ? `${game.startsAt}T12:00:00Z` : game.startsAt);
  if (!Number.isFinite(t)) return false;
  return t - nowMs <= WATCH_BEFORE_MS && nowMs - t <= WATCH_AFTER_MS;
}

/** The wait before the next request; null = stop. `rand` ∈ [0, 1). */
export function nextDelay(pollMs: number, failures: number, rand: number): number | null {
  const jitter = 0.8 + 0.4 * Math.min(Math.max(rand, 0), 0.999);
  if (failures > 0) return Math.round(Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(failures - 1, 8)) * jitter);
  if (!(pollMs > 0)) return null;
  return Math.round(pollMs * jitter);
}

export function mergeFeed(current: LiveFeed | null, incoming: LiveFeed): LiveFeed {
  if (!current) return incoming;
  return Date.parse(incoming.at) >= Date.parse(current.at) ? incoming : current;
}

export function autoPollAllowed(env: { saveData?: boolean; reducedData?: boolean }): boolean {
  return !env.saveData && !env.reducedData;
}

/** The card's game in a feed, or null (the game left the feed — keep the
 *  last copy the card has). */
export function gameIn(feed: LiveFeed | null, id: string): LiveFeedGame | null {
  return feed?.games.find(g => g.id === id) ?? null;
}
