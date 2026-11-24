'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '@/lib/auth';

/**
 * The sport picker's LAST tag (Nov 23 2026): the sport of the account's
 * newest sport post, from GET /api/settings/last-sport. Asked each time the
 * picker mounts (it unmounts on every pick, and a post made since changes
 * the answer); the last answer is kept at module level so the tag is there
 * on the next open without a flash. A hint only: a failed read keeps the
 * previous answer and shows nothing new.
 */
const store: { sport: string | null; owner: string | null } = { sport: null, owner: null };
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getSnapshot = () => store.sport;
const getServerSnapshot = () => null;

export function useLastSport(): string | null {
  const { profile } = useAuth();
  const ownerId = profile?.id ?? null;
  const sport = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (!ownerId) return;
    let cancelled = false;
    fetch('/api/settings/last-sport', { credentials: 'include' })
      .then(res => (res.ok ? res.json() : null))
      .then((body: { sport?: unknown } | null) => {
        if (cancelled || !body) return;
        const next = typeof body.sport === 'string' ? body.sport : null;
        if (store.sport === next && store.owner === ownerId) return;
        store.sport = next;
        store.owner = ownerId;
        for (const l of listeners) l();
      })
      .catch(() => { /* a hint only */ });
    return () => { cancelled = true; };
  }, [ownerId]);

  return store.owner === ownerId ? sport : null;
}
