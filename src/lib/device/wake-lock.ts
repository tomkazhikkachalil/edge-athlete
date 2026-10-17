'use client';

// ── Keep the screen on during a session (one hook, every session) ───────────
// Live Activities first (a web page receives GPS only in the foreground with
// the screen on), the workout screen since Oct 17 2026 (Tom: the screen must
// not turn itself off while recording an activity, a sport session or a
// workout — the round timer rides the recorder). It only stops the automatic
// screen timeout: locking the phone or switching apps stays the person's.
// Feature-detected (iOS 16.4+, Chrome, Firefox 126+; the iOS 15 floor gets
// the copy "keep your screen on") and never an error. The OS releases the
// lock whenever the page is hidden, so it is requested again on return.

import { useEffect, useState } from 'react';
import { createWakeLockController, type WakeLockSentinelLike } from './wake-lock-controller';

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
    const nav = navigator as Navigator & { wakeLock: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } };
    const lock = createWakeLockController(() => nav.wakeLock.request('screen'), setHeld);
    void lock.acquire();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void lock.acquire();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      lock.stop();
    };
  }, [active]);
  return held;
}
