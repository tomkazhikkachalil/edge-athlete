'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventApi } from '@/lib/sport-events/client';
import type { RoundStatsPayload } from '@/lib/sport-events/stats-server';

const LIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 30_000;

/**
 * A team round's stats, polled (Events program, phase 4): fetched on
 * mount, every 5 s while the round is live and 30 s otherwise, and on
 * becoming visible; `refresh()` is the outbox's `onFlushed` (the overlay
 * lifts once the server's copy carries the write). Posture-A tables emit
 * no realtime — the poll IS the live feed, never disabled behind a channel.
 */
export function useRoundStats(api: EventApi, roundId: string | null, live: boolean, enabled = true) {
  const [data, setData] = useState<RoundStatsPayload | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!roundId || !enabled || inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await api.roundStats(roundId);
      if (res.ok && res.data) { setData(res.data); setState('ready'); } else setState('error');
    } finally {
      inFlight.current = false;
    }
  }, [api, roundId, enabled]);

  useEffect(() => {
    if (!roundId || !enabled) return;
    let cancelled = false;
    const load = () => { if (!cancelled) void refresh(); };
    load();
    // The 5 s live poll pauses while the tab is hidden (Round 3); the
    // visibilitychange listener below loads once on return.
    const tick = () => { if (document.visibilityState === 'visible') load(); };
    const t = window.setInterval(tick, live ? LIVE_POLL_MS : IDLE_POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; window.clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [refresh, roundId, live, enabled]);

  return { data, state, refresh };
}
