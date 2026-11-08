'use client';

/**
 * The device store (performance program, Phase 2b — Nov 2026): the profile,
 * the pulse's numbers and the feed's first page, kept in localStorage under
 * the account's key so the installed app paints what it had the moment it
 * reopens, then revalidates. The rules are hydration-rules.ts; this file is
 * the mechanism — every read and write is wrapped, because storage can be
 * absent (a private window, a blocked origin, a full quota), and the app
 * must run exactly as before without it.
 */

import { acceptEnvelope, hydrationKey, isHydrationKey, makeEnvelope, type HydrationKind } from './hydration-rules';

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** This account's copy of a kind, or null (absent, stale, another account's, unreadable). */
export function readDevice<T>(userId: string, kind: HydrationKind): T | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(hydrationKey(userId, kind));
    if (!raw) return null;
    return acceptEnvelope<T>(JSON.parse(raw), userId, kind, Date.now());
  } catch {
    return null;
  }
}

/** Keep a copy; a failure (quota, private mode) is silent — the network path is unchanged. */
export function writeDevice<T>(userId: string, kind: HydrationKind, value: T): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(hydrationKey(userId, kind), JSON.stringify(makeEnvelope(userId, value, Date.now())));
  } catch {
    /* no room, or no storage — the next open fetches as before */
  }
}

/** Sign-out, a 401, a different account: every hydration key goes, whoever's. */
export function clearDevice(): void {
  const s = storage();
  if (!s) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && isHydrationKey(k)) keys.push(k);
    }
    for (const k of keys) s.removeItem(k);
  } catch {
    /* nothing to clear, or no storage */
  }
}
