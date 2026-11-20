// A provider that is DOWN is not waited on by every golfer (Nov 19 2026).
//
// Measured that day: OpenGolfAPI answered HTTP 500 after 20 s for hours, and
// every course pick and every course search waited out our whole timeout on
// it before going on to the provider that works. This file is the memory of
// "that host just failed": after a failure that means the HOST is in trouble
// (a timeout, a network error, a 5xx), calls to it are answered at once with
// `down` for a short while; then ONE call is let through to see, and a
// success clears it.
//
// Zero imports, no I/O, the clock passed in: pure, and pinned by its tests.
// The memory is per server instance (a warm instance serves many requests);
// a cold instance learns it again with one slow call. Nothing is stored.

/** How long a failed host is skipped before one call tries it again. */
export const PROVIDER_DOWN_MS = 3 * 60_000;

export type ProviderFailure = number | 'timeout' | 'network';

/** A failure that says the HOST is in trouble. A 4xx is an answer about the
 *  request (not found, bad key, too many), never a reason to skip the host. */
export function isHostFailure(status: ProviderFailure): boolean {
  return status === 'timeout' || status === 'network' || (typeof status === 'number' && status >= 500);
}

export interface ProviderBreaker {
  /** True while the host is being skipped. */
  isDown(host: string): boolean;
  /** The outcome of a call that was actually made. */
  record(host: string, outcome: 'ok' | ProviderFailure): void;
  /** For tests and an admin read: the hosts being skipped and until when. */
  snapshot(): Record<string, number>;
}

export function createProviderBreaker(now: () => number = Date.now, downMs: number = PROVIDER_DOWN_MS): ProviderBreaker {
  const until = new Map<string, number>();
  return {
    isDown(host) {
      const t = until.get(host);
      if (t === undefined) return false;
      if (now() < t) return true;
      // The wait is over: this caller is the one that tries the host again.
      until.delete(host);
      return false;
    },
    record(host, outcome) {
      if (outcome === 'ok') until.delete(host);
      else if (isHostFailure(outcome)) until.set(host, now() + downMs);
    },
    snapshot() {
      const out: Record<string, number> = {};
      for (const [host, t] of until) if (now() < t) out[host] = t;
      return out;
    },
  };
}

/** The host of a URL, or '' for something that is not one. */
export function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return ''; }
}
