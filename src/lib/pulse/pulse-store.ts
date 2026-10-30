/**
 * The pulse store — ONE module-level store for the header's numbers (the
 * cost program PR B, Oct 29 2026; docs/specs/pulse.md). The shape
 * `useLiveNow` had: a module cache shared by every mount (the header AND
 * the tab bar mount on every page), one coalesced fetch, one timer for the
 * whole tab that skips hidden and offline tabs, one catch-up on return.
 * Deliberately NOT a context provider — a provider would mean mounting a
 * fetch for signed-out visitors on public pages; subscribers opt in.
 *
 * The only place in the app that fetches `/api/me/pulse` (pinned by
 * src/lib/__tests__/me-pulse.test.ts).
 */
import { getOnline } from '@/lib/net/online';
import {
  EMPTY_PULSE,
  PULSE_REFRESH_MS,
  adjustUnread,
  planPulseFetch,
  readPulsePayload,
  signalDelayMs,
  type PulseReason,
  type PulseSnapshot,
} from './pulse-rules';

type Listener = (snapshot: PulseSnapshot) => void;

let snapshot: PulseSnapshot = EMPTY_PULSE;
const listeners = new Set<Listener>();
let inFlight: Promise<PulseSnapshot> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let signalTimer: ReturnType<typeof setTimeout> | null = null;

function notify(): void {
  listeners.forEach(fn => fn(snapshot));
}

function visible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

/** The current numbers (0 / 0 until the first answer). */
export function getPulse(): PulseSnapshot {
  return snapshot;
}

/** Fetch once; concurrent callers share the one request. A failure keeps the numbers. */
export function fetchPulse(): Promise<PulseSnapshot> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetch('/api/me/pulse', { credentials: 'include' });
      if (!res.ok) return snapshot;
      snapshot = readPulsePayload(await res.json(), snapshot, Date.now());
      notify();
      return snapshot;
    } catch {
      // The numbers are a nicety: a blip shows the last answer, never an error.
      return snapshot;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Ask for a fetch for a reason; the rules decide. */
export function requestPulse(reason: PulseReason): void {
  if (reason === 'signal') {
    if (signalTimer) return; // a burst is one fetch
    signalTimer = setTimeout(() => {
      signalTimer = null;
      if (planPulseFetch({ reason, lastFetchedAt: snapshot.fetchedAt, now: Date.now(), visible: visible(), online: getOnline() }) === 'fetch') void fetchPulse();
    }, signalDelayMs(Math.random()));
    return;
  }
  const plan = planPulseFetch({ reason, lastFetchedAt: snapshot.fetchedAt, now: Date.now(), visible: visible(), online: getOnline() });
  if (plan === 'fetch') void fetchPulse();
}

/** A conversation was read here: correct the number without a fetch. */
export function adjustPulseUnread(delta: number): void {
  const next = adjustUnread(snapshot, delta);
  if (next === snapshot) return;
  snapshot = next;
  notify();
}

/** Logout: nothing is live and nothing is unread for nobody. */
export function resetPulse(): void {
  snapshot = EMPTY_PULSE;
  notify();
}

function onResume(): void {
  requestPulse('resume');
}

function start(): void {
  if (timer) return;
  timer = setInterval(() => requestPulse('timer'), PULSE_REFRESH_MS);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('online', onResume);
  }
}

function stopIfUnused(): void {
  if (listeners.size > 0 || !timer) return;
  clearInterval(timer);
  timer = null;
  if (signalTimer) {
    clearTimeout(signalTimer);
    signalTimer = null;
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onResume);
    window.removeEventListener('online', onResume);
  }
}

/**
 * Subscribe to the numbers. The first subscriber starts the timer and the
 * resume catch-up; the last one leaving stops them. Returns the cleanup.
 */
export function subscribePulse(listener: Listener): () => void {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
    stopIfUnused();
  };
}
