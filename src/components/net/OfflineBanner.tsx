'use client';

/**
 * The offline banner (maintenance pass, Oct 10 2026): mounted once in the
 * app's root layout. Offline → a calm pill above the tab bar (and the desktop
 * chat dock's lane) saying the work is safe on this device; back online → a
 * short "Back online". Pollers pause on their own (net/online.ts shouldPoll).
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getOnline, getOnlineServer, subscribeOnline } from '@/lib/net/online';
import { COPY } from '@/lib/copy';

const BACK_ONLINE_MS = 2500;

export default function OfflineBanner() {
  const online = useSyncExternalStore(subscribeOnline, getOnline, getOnlineServer);
  const wasOffline = useRef(false);
  const [backOnline, setBackOnline] = useState(false);

  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      return;
    }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    const show = window.setTimeout(() => setBackOnline(true), 0);
    const hide = window.setTimeout(() => setBackOnline(false), BACK_ONLINE_MS);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [online]);

  const visible = !online || backOnline;
  return (
    <div
      role="status"
      aria-live="polite"
      data-offline-banner={online ? (backOnline ? 'back' : 'hidden') : 'offline'}
      className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-4"
      style={{ bottom: 'calc(var(--ea-tabbar-h, 0px) + var(--ea-dock-h, 0px) + 12px + env(safe-area-inset-bottom, 0px))' }}
    >
      {visible && (
        <p
          className={`pointer-events-auto flex max-w-md items-start gap-2 rounded-2xl px-4 py-3 text-sm font-medium shadow-lg ring-1 ${
            online
              ? 'bg-emerald-50 text-emerald-900 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-100 dark:ring-emerald-800'
              : 'bg-stone-900 text-white ring-white/10 dark:bg-stone-800 dark:text-stone-50 dark:ring-white/15'
          }`}
        >
          <i className={`fas ${online ? 'fa-wifi' : 'fa-cloud-arrow-up'} mt-0.5`} aria-hidden="true"></i>
          <span>{online ? COPY.NETWORK.BACK_ONLINE : COPY.NETWORK.OFFLINE}</span>
        </p>
      )}
    </div>
  );
}
