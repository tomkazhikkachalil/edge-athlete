// ── The screen wake lock, as plain logic (Oct 17 2026) ──────────────────────
// Zero imports, so node tests drive it with a fake lock. The hook in
// wake-lock.ts wires it to `navigator.wakeLock` and `visibilitychange`.
//
// One controller per active session. `acquire()` asks for the lock (again on
// every return to the page — the OS drops it whenever the page is hidden);
// `stop()` releases it for good. Only the CURRENT lock may report "released":
// a late event from a lock already replaced is ignored, and a lock that
// arrives after `stop()` is handed straight back.

export interface WakeLockSentinelLike {
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
}

export interface WakeLockController {
  acquire: () => Promise<void>;
  stop: () => void;
}

export function createWakeLockController(
  request: () => Promise<WakeLockSentinelLike>,
  onHeld: (held: boolean) => void,
): WakeLockController {
  let current: WakeLockSentinelLike | null = null;
  let stopped = false;

  const releaseQuietly = (s: WakeLockSentinelLike) => {
    void s.release().catch(() => undefined);
  };

  return {
    async acquire() {
      if (stopped) return;
      // A lock still held is released before asking again, never leaked.
      const previous = current;
      current = null;
      if (previous) releaseQuietly(previous);
      let next: WakeLockSentinelLike;
      try {
        next = await request();
      } catch {
        if (!stopped && current === null) onHeld(false);
        return;
      }
      if (stopped || current !== null) {
        releaseQuietly(next);
        return;
      }
      current = next;
      onHeld(true);
      next.addEventListener?.('release', () => {
        if (current !== next) return;
        current = null;
        onHeld(false);
      });
    },
    stop() {
      stopped = true;
      const held = current;
      current = null;
      if (held) releaseQuietly(held);
      onHeld(false);
    },
  };
}
