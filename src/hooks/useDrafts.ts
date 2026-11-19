'use client';

import { useEffect, useState } from 'react';
import type { DraftsList } from '@/lib/drafts/list';
import { subscribeLiveSignal } from '@/lib/pulse/pulse-store';

/**
 * The viewer's drafts (Drafts round, Oct 2026): ONE fetch per page load,
 * shared by the header's "Drafts" entry, the Drafts page and the reopen
 * prompt through a module-level cache — the useLiveNow shape, without the
 * poll: every door that acts calls `refreshDrafts()`.
 *
 * Nov 19 2026 (Tom: a round finished on one device stayed live on the other):
 * "a draft changes only when the viewer acts" was true of ONE device. A round
 * finished, posted or discarded on the phone left the laptop's resume pill and
 * Drafts entry live until a reload, and an installed app rarely reloads. So
 * while this device holds something in progress it also listens: the platform's
 * live signal (a round leaving "live" is one), and coming back to the tab.
 */

export type DraftsSnapshot = DraftsList & { count: number; /** The server has answered at least once this page load. */ loaded: boolean };

const EMPTY: DraftsSnapshot = { inProgress: [], drafts: [], count: 0, loaded: false };

let cached: DraftsSnapshot | null = null;
let inFlight: Promise<DraftsSnapshot> | null = null;
const subscribers = new Set<(s: DraftsSnapshot) => void>();

function publish(s: DraftsSnapshot): void {
  cached = s;
  for (const fn of subscribers) fn(s);
}

export async function refreshDrafts(): Promise<DraftsSnapshot> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetch('/api/drafts', { cache: 'no-store' });
      if (!res.ok) return cached ?? EMPTY;
      const body = (await res.json()) as DraftsSnapshot;
      const next: DraftsSnapshot = {
        inProgress: Array.isArray(body.inProgress) ? body.inProgress : [],
        drafts: Array.isArray(body.drafts) ? body.drafts : [],
        count: typeof body.count === 'number' ? body.count : 0,
        loaded: true,
      };
      publish(next);
      return next;
    } catch {
      return cached ?? EMPTY;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Forget the cache (sign-out, a different account). */
export function resetDrafts(): void {
  cached = null;
}

/** A return to the tab refreshes only what is older than this. */
export const DRAFTS_RESUME_STALE_MS = 15_000;
let lastRefreshAt = 0;
let stopListening: (() => void) | null = null;

/** Something in progress here may have ended elsewhere. Nothing in progress:
 *  nothing to drop, and no fetch (the live signal is platform-wide). */
function refreshIfHolding(): void {
  if (!cached || cached.inProgress.length === 0) return;
  lastRefreshAt = Date.now();
  void refreshDrafts();
}

function listen(): void {
  if (stopListening || typeof document === 'undefined') return;
  const onResume = () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastRefreshAt < DRAFTS_RESUME_STALE_MS) return;
    refreshIfHolding();
  };
  const offSignal = subscribeLiveSignal(refreshIfHolding);
  document.addEventListener('visibilitychange', onResume);
  window.addEventListener('online', onResume);
  stopListening = () => {
    offSignal();
    document.removeEventListener('visibilitychange', onResume);
    window.removeEventListener('online', onResume);
    stopListening = null;
  };
}

export function useDrafts(enabled: boolean): DraftsSnapshot {
  const [snapshot, setSnapshot] = useState<DraftsSnapshot>(cached ?? EMPTY);
  useEffect(() => {
    if (!enabled) return;
    subscribers.add(setSnapshot);
    listen();
    // No setState here for the fresh-cache case: useState initialised from
    // the cache, and any later answer arrives through the subscriber.
    if (!cached) void refreshDrafts();
    return () => {
      subscribers.delete(setSnapshot);
      if (subscribers.size === 0) stopListening?.();
    };
  }, [enabled]);
  return enabled ? snapshot : EMPTY;
}
