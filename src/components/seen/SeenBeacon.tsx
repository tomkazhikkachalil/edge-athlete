'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { todayUTC } from '@/lib/views/client';

/**
 * The seen mark (migration 267): once per account per UTC day, the app
 * shell tells the server "this account opened the app signed in" —
 * POST /api/seen → bump_profile_seen. Nothing else travels. The device
 * remembers the day it last sent (so a reload costs nothing); the server
 * dedups tabs with a cookie and the row itself is idempotent. Re-armed when
 * the page comes back into view (the installed app left open past midnight)
 * and when the account changes (a shared device). Renders nothing.
 */
const KEY = (userId: string) => `ea-seen:${userId}`;

function sentToday(userId: string): boolean {
  try {
    return window.localStorage.getItem(KEY(userId)) === todayUTC();
  } catch {
    return false;
  }
}

function remember(userId: string): void {
  try {
    window.localStorage.setItem(KEY(userId), todayUTC());
  } catch {
    /* storage blocked: the server's cookie still dedups */
  }
}

export default function SeenBeacon() {
  const { user, initialAuthCheckComplete } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!initialAuthCheckComplete || !userId) return;
    const send = () => {
      if (document.visibilityState !== 'visible' || sentToday(userId)) return;
      remember(userId);
      fetch('/api/seen', { method: 'POST', keepalive: true, credentials: 'same-origin' }).catch(() => {
        /* a beacon never surfaces; tomorrow tries again */
      });
    };
    send();
    document.addEventListener('visibilitychange', send);
    return () => document.removeEventListener('visibilitychange', send);
  }, [initialAuthCheckComplete, userId]);

  return null;
}
