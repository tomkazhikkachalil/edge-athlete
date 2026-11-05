'use client';

import { useEffect, useState } from 'react';
import { getPulse, requestPulse, subscribePulse } from '@/lib/pulse/pulse-store';

/**
 * Is anything actually live right now?
 *
 * The header's Live indicator used to pulse permanently — it was driven by a
 * static `accent: 'live'` literal in the nav config, not by data, so it claimed
 * "live" every second of every day. Promoting it to a status chip made that
 * worse, so it now needs the truth.
 *
 * The truth comes from the pulse store (`src/lib/pulse/`, the cost program
 * PR B, Oct 29 2026): ONE fetch of `/api/me/pulse` — one RPC answering the
 * live golf rounds, the live events AND the unread messages — shared by the
 * header, the tab bar and the messages provider through a module-level
 * store. Before, this hook alone polled two endpoints a minute on every
 * authenticated page for every visible tab.
 *
 * `enabled` gates the subscription on having a session: the endpoint is
 * authenticated, so polling it signed-out (AppHeader renders on public
 * pages) can only ever produce a 401 per minute of console noise.
 */
export function useLiveNow(enabled: boolean = true): number {
  const [count, setCount] = useState(() => getPulse().liveNow);

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = subscribePulse(s => setCount(s.liveNow));
    // Reuse a recent answer rather than refetching on every navigation (the
    // rules' stale gate); the store's one timer and resume catch-up do the rest.
    requestPulse('mount');
    return unsubscribe;
  }, [enabled]);

  return enabled ? count : 0;
}
