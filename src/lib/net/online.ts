/**
 * Is this device online? (Maintenance pass, Oct 10 2026.) ONE store for the
 * offline banner and every poller: `navigator.onLine` plus the `online` /
 * `offline` events, read through `useSyncExternalStore` (React 18+, fine on
 * the iOS 15 floor). `navigator.onLine === false` is the browser saying it
 * has no network at all — it can still be TRUE behind a captive portal, so
 * this never claims "online" means "reachable"; it only stops work that
 * cannot succeed.
 */

type Listener = () => void;
const listeners = new Set<Listener>();
let wired = false;

function readOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function wire(): void {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  const notify = () => listeners.forEach(l => l());
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
}

export function subscribeOnline(listener: Listener): () => void {
  wire();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getOnline(): boolean {
  return readOnline();
}

/** The server render has no network state: online. */
export function getOnlineServer(): boolean {
  return true;
}

/** A poller's tick: only while the page is visible AND the device is online. */
export function shouldPoll(): boolean {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false;
  return readOnline();
}

/** Runs `cb` when the page comes back into view or the network comes back —
 *  the two moments a paused poller catches up. Returns the cleanup. */
export function onResume(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onVisible = () => {
    if (shouldPoll()) cb();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onVisible);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onVisible);
  };
}
