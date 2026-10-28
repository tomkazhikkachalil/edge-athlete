'use client';

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { getAllSports } from '@/lib/sports/SportRegistry';
import { sanitizeFavouriteSports, toggleFavourite } from '@/lib/sports/favourite-sports';
import { createSerialQueue } from '@/lib/serial-queue';

/**
 * The account's favourite sports for the post composer's picker (285).
 *
 * The truth arrives on `useAuth().profile.favourite_sports` (the ACCOUNT's
 * own row — never a guardian-managed activeProfile: a guardian's stars are
 * their own). A star tap applies at once, then persists the WHOLE list
 * through PATCH /api/settings/favourite-sports, one save at a time
 * (serial-queue.ts — the theme-prefs shape). On failure the tap is rolled
 * back unless a newer tap has landed, and the one error card shows; a gold
 * star is its own confirmation, so a success shows nothing (Oct 15 rule).
 *
 * The device's copy lives at module level, not in the component: the picker
 * unmounts on every pick and the profile is not re-fetched after a save, so
 * a per-instance copy would forget the tap on the next open. The copy stands
 * until the SERVER value actually changes (a later profile load) — and never
 * while a save is in flight or within a short grace after one, because that
 * read may predate the save.
 */
const store: { override: string[] | null; owner: string | null; baseKey: string } = { override: null, owner: null, baseKey: '' };
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getOverride = () => store.override;
const getServerSnapshot = () => null;

const enqueueSave = createSerialQueue();
let pendingSaves = 0;
let lastSaveSettledAt = 0;
const ADOPT_GRACE_MS = 10_000;

function persistToServer(sports: string[]): Promise<Response> {
  return fetch('/api/settings/favourite-sports', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ sports }),
  });
}

export interface UseFavouriteSportsResult {
  /** Sanitized, sorted registry keys. */
  favourites: string[];
  /** False until the account's own profile is loaded — the picker shows no stars. */
  canFavourite: boolean;
  /** A star tap. Resolves true when the save landed, false when it was rolled back. */
  toggle: (sportKey: string) => Promise<boolean>;
}

export function useFavouriteSports(): UseFavouriteSportsResult {
  const { profile } = useAuth();
  const { showError } = useToast();
  const override = useSyncExternalStore(subscribe, getOverride, getServerSnapshot);

  const known = useMemo(() => getAllSports().map(s => s.sport_key as string), []);
  const raw = profile?.favourite_sports;
  const server = useMemo(() => sanitizeFavouriteSports(raw, known), [raw, known]);
  const serverKey = JSON.stringify(server);
  const ownerId = profile?.id ?? null;

  // A new server value (a later profile load) retires the device's copy —
  // unless that read may predate a save still in flight or just settled.
  useEffect(() => {
    if (store.override === null) return;
    if (store.owner !== ownerId || serverKey !== store.baseKey) {
      if (pendingSaves > 0 || Date.now() - lastSaveSettledAt < ADOPT_GRACE_MS) return;
      store.override = null;
      store.owner = null;
      emit();
    }
  }, [serverKey, ownerId]);

  const favourites = override !== null && store.owner === ownerId ? override : server;

  const toggle = useCallback(async (sportKey: string): Promise<boolean> => {
    if (!ownerId) return false;
    const previous = store.override !== null && store.owner === ownerId ? store.override : server;
    const next = toggleFavourite(previous, sportKey, known);
    store.override = next;
    store.owner = ownerId;
    store.baseKey = serverKey;
    emit();
    pendingSaves += 1;
    return enqueueSave(async () => {
      try {
        const res = await persistToServer(next);
        if (!res.ok) throw new Error(`favourites save ${res.status}`);
        return true;
      } catch {
        if (store.override === next) {
          store.override = previous;
          emit();
        }
        showError('Could not save favourite');
        return false;
      } finally {
        pendingSaves -= 1;
        lastSaveSettledAt = Date.now();
      }
    });
  }, [ownerId, server, serverKey, known, showError]);

  return { favourites, canFavourite: Boolean(ownerId), toggle };
}
