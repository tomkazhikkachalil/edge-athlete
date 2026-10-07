'use client';

import { useEffect, useState } from 'react';
import type { DraftsList } from '@/lib/drafts/list';

/**
 * The viewer's drafts (Drafts round, Oct 2026): ONE fetch per page load,
 * shared by the header's "Drafts" entry, the Drafts page and the reopen
 * prompt through a module-level cache — the useLiveNow shape, without the
 * poll: a draft changes only when the viewer acts, and every door that acts
 * calls `refreshDrafts()`.
 */

export type DraftsSnapshot = DraftsList & { count: number };

const EMPTY: DraftsSnapshot = { inProgress: [], drafts: [], count: 0 };

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

export function useDrafts(enabled: boolean): DraftsSnapshot {
  const [snapshot, setSnapshot] = useState<DraftsSnapshot>(cached ?? EMPTY);
  useEffect(() => {
    if (!enabled) return;
    subscribers.add(setSnapshot);
    // No setState here for the fresh-cache case: useState initialised from
    // the cache, and any later answer arrives through the subscriber.
    if (!cached) void refreshDrafts();
    return () => {
      subscribers.delete(setSnapshot);
    };
  }, [enabled]);
  return enabled ? snapshot : EMPTY;
}
