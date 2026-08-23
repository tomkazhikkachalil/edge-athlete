'use client';

import { useEffect, useState } from 'react';

/**
 * Is anything actually live right now?
 *
 * The header's Live indicator used to pulse permanently — it was driven by a
 * static `accent: 'live'` literal in the nav config, not by data, so it claimed
 * "live" every second of every day. Promoting it to a status chip made that
 * worse, so it now needs the truth.
 *
 * ONE fetch per page, shared by every caller through a module-level cache:
 * `LiveNowStrip` already polls this endpoint on /feed, /explore and /live, so
 * on those pages this adds no request at all. Elsewhere it is one cheap call.
 *
 * Deliberately NOT a context provider: that would mean touching the root layout
 * and mounting a fetch for signed-out visitors on public pages. A module cache
 * gets the same sharing with none of that.
 */

const REFRESH_MS = 60_000;
/** How long a fetched answer is reused before anyone refetches. */
const STALE_MS = 30_000;

let cachedCount: number | null = null;
let cachedAt = 0;
let inFlight: Promise<number> | null = null;
const subscribers = new Set<(count: number) => void>();

async function fetchLiveCount(): Promise<number> {
  // Coalesce: several components mounting at once must not each fire a request.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch('/api/golf/live-now', { credentials: 'include' });
      if (!res.ok) return cachedCount ?? 0;
      const data = await res.json();
      return Array.isArray(data.rounds) ? data.rounds.length : 0;
    } catch {
      // An indicator is a nicety. A failure means "show nothing", never an
      // error state in the header.
      return cachedCount ?? 0;
    } finally {
      inFlight = null;
    }
  })();

  const count = await inFlight;
  cachedCount = count;
  cachedAt = Date.now();
  subscribers.forEach(fn => fn(count));
  return count;
}

/**
 * Number of rounds currently live. 0 until the first answer arrives.
 *
 * `enabled` gates the fetch on having a session: the endpoint is
 * authenticated, so polling it signed-out (AppHeader renders on public
 * pages) can only ever produce a 401 per minute of console noise.
 */
export function useLiveNow(enabled: boolean = true): number {
  const [count, setCount] = useState(cachedCount ?? 0);

  useEffect(() => {
    if (!enabled) return;
    subscribers.add(setCount);

    // Reuse a recent answer rather than refetching on every navigation. No
    // setState here for the fresh-cache case: useState already initialised
    // from the cache above, and any later change arrives via the subscriber.
    if (cachedCount === null || Date.now() - cachedAt > STALE_MS) {
      fetchLiveCount();
    }

    const interval = setInterval(fetchLiveCount, REFRESH_MS);
    return () => {
      subscribers.delete(setCount);
      clearInterval(interval);
    };
  }, [enabled]);

  return enabled ? count : 0;
}
