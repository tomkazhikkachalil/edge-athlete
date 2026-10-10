'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cheerEmoji, emptyTotals, freshEvents, type CheerFeed, type CheerKey } from '@/lib/play/cheers';
import { shouldPoll } from '@/lib/net/online';

const POLL_MS = 10_000;
/** A round that is not live (finished, not started) is read once a minute —
 *  its totals cannot move, but a scheduled round can still go live. */
const QUIET_POLL_MS = 60_000;
const FLOAT_MS = 1_800;
const FLOAT_CAP = 12;

export interface Float { id: string; emoji: string; left: number }

type SendOutcome = 'ok' | 'not_live' | 'slow_down' | 'signed_out' | 'error';

/**
 * A live round's cheers (the Play program, 244): the counts, and a float per
 * NEW cheer — polled every 10 s while the tab is visible (the round-stats
 * poll's shape; posture-A tables emit no realtime), quiet while hidden,
 * once on return. `send` floats the viewer's own tap at once (optimistic)
 * and remembers its id so the next poll never floats it twice.
 */
export function useCheers(contextKey: string, enabled = true) {
  const [totals, setTotals] = useState<Record<CheerKey, number>>(emptyTotals);
  const [total, setTotal] = useState(0);
  const [live, setLive] = useState(false);
  const [ready, setReady] = useState(false);
  const [floats, setFloats] = useState<Float[]>([]);
  const since = useRef<string | null>(null);
  const seen = useRef(new Set<string>());
  const inFlight = useRef(false);
  const liveRef = useRef<boolean | null>(null);
  const lastPoll = useRef(0);

  const float = useCallback((id: string, cheer: CheerKey) => {
    const f: Float = { id, emoji: cheerEmoji(cheer), left: 10 + Math.round(Math.random() * 80) };
    setFloats(prev => [...prev.slice(-(FLOAT_CAP - 1)), f]);
    window.setTimeout(() => setFloats(prev => prev.filter(x => x.id !== id)), FLOAT_MS);
  }, []);

  const poll = useCallback(async () => {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    lastPoll.current = Date.now();
    try {
      const q = new URLSearchParams({ context: contextKey });
      if (since.current) q.set('since', since.current);
      const res = await fetch(`/api/live/cheers?${q}`, { credentials: 'include' });
      if (!res.ok) return;
      const feed = (await res.json()) as CheerFeed & { live: boolean };
      setTotals(feed.totals);
      setTotal(feed.total);
      setLive(feed.live);
      liveRef.current = feed.live;
      setReady(true);
      // The first read is the baseline: past cheers are counted, never floated.
      if (since.current) {
        for (const e of freshEvents(feed.recent, seen.current)) {
          seen.current.add(e.id);
          float(e.id, e.cheer);
        }
      }
      since.current = feed.now;
    } catch {
      /* a missed poll is the next poll's job */
    } finally {
      inFlight.current = false;
    }
  }, [contextKey, enabled, float]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () => { if (!cancelled) void poll(); };
    load();
    const tick = () => {
      if (!shouldPoll()) return;
      // Not live: the quiet cadence (a finished round left open polled 6×/min forever).
      if (liveRef.current === false && Date.now() - lastPoll.current < QUIET_POLL_MS) return;
      load();
    };
    const t = window.setInterval(tick, POLL_MS);
    const onVisible = () => { if (shouldPoll()) load(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => { cancelled = true; window.clearInterval(t); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', onVisible); };
  }, [poll, enabled]);

  const send = useCallback(async (cheer: CheerKey): Promise<SendOutcome> => {
    const tempId = `mine-${Date.now()}-${Math.random()}`;
    float(tempId, cheer);
    setTotals(prev => ({ ...prev, [cheer]: prev[cheer] + 1 }));
    setTotal(prev => prev + 1);
    const undo = () => {
      setTotals(prev => ({ ...prev, [cheer]: Math.max(0, prev[cheer] - 1) }));
      setTotal(prev => Math.max(0, prev - 1));
    };
    try {
      const res = await fetch('/api/live/cheers', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: contextKey, cheer }),
      });
      if (res.status === 201) {
        const body = (await res.json()) as { id: string; totals: Record<CheerKey, number>; total: number };
        seen.current.add(body.id);
        setTotals(body.totals);
        setTotal(body.total);
        return 'ok';
      }
      undo();
      if (res.status === 409) { setLive(false); return 'not_live'; }
      if (res.status === 429) return 'slow_down';
      if (res.status === 401) return 'signed_out';
      return 'error';
    } catch {
      undo();
      return 'error';
    }
  }, [contextKey, float]);

  return { totals, total, live, ready, floats, send };
}
