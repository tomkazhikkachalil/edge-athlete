'use client';

// ── Keep the screen on while recording (Live Activities) ────────────────────
// A web page receives GPS only while it is in the foreground with the screen
// on, so the recorder asks for a screen wake lock where the browser has one
// (iOS 16.4+, Chrome; feature-detected — the iOS 15 floor gets the copy
// "keep your screen on"). The OS releases the lock whenever the page is
// hidden, so it is requested again when the page comes back.

import { useEffect, useState } from 'react';

interface WakeLockSentinelLike {
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
}

export function hasWakeLock(): boolean {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { wakeLock?: { request?: unknown } }) : null;
  return !!nav?.wakeLock && typeof nav.wakeLock.request === 'function';
}

/** True while the lock is held; false when the browser has none or released it. */
export function useWakeLock(active: boolean): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!active || !hasWakeLock()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the lock's state is the effect's own
      setHeld(false);
      return;
    }
    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } };
        const s = await nav.wakeLock.request('screen');
        if (cancelled) {
          void s.release().catch(() => undefined);
          return;
        }
        sentinel = s;
        setHeld(true);
        s.addEventListener?.('release', () => setHeld(false));
      } catch {
        setHeld(false);
      }
    };
    void request();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
      sentinel = null;
    };
  }, [active]);
  return held;
}
