/**
 * The pulse — pure rules, zero imports (the cost program PR B, Oct 29 2026;
 * docs/specs/pulse.md). The signed-in header needs two numbers on every
 * page: is anything live (the Live dot) and how many messages are unread
 * (the bell). They used to be three polls — two a minute plus one every two
 * minutes — each a Vercel function call with its own Supabase trips, for
 * every visible tab, all day: the single largest sustained cost in the app.
 * Now they are ONE fetch of `/api/me/pulse` (one RPC), and these rules say
 * WHEN that fetch happens so that the number of calls is bounded while the
 * numbers stay as fresh as before.
 */

/** The wire shape of GET /api/me/pulse. */
export interface PulsePayload {
  liveNow: { golf: number; events: number; total: number };
  unread: { messages: number };
}

/** What the client keeps. */
export interface PulseSnapshot {
  liveNow: number;
  unreadMessages: number;
  /** Epoch ms of the last successful fetch; 0 = never. */
  fetchedAt: number;
}

export const EMPTY_PULSE: PulseSnapshot = { liveNow: 0, unreadMessages: 0, fetchedAt: 0 };

/** The safety-net timer: the Live dot's old cadence, until the change signals land (PR C). */
export const PULSE_REFRESH_MS = 60_000;
/** A fetched answer is reused this long on a mount or a return to the tab. */
export const PULSE_STALE_MS = 30_000;
/** A change signal waits this long before fetching, so a burst is one fetch… */
export const SIGNAL_DEBOUNCE_MS = 1_500;
/** …and a platform-wide signal spreads its fetches over this window. */
export const SIGNAL_JITTER_MS = 3_000;

export type PulseReason =
  /** A subscriber mounted (a navigation, the first paint). */
  | 'mount'
  /** The safety-net timer. */
  | 'timer'
  /** The tab came back into view or the network returned. */
  | 'resume'
  /** A change signal: a message, a round or event going live or ending. */
  | 'signal'
  /** A caller asked for the truth now (a read, a reconnect). */
  | 'demand';

/**
 * Fetch or skip. Hidden or offline never fetches (the resume catch-up
 * covers the return); a mount or a resume reuses a fresh answer; the timer,
 * a signal and a demand always fetch.
 */
export function planPulseFetch(input: {
  reason: PulseReason;
  lastFetchedAt: number;
  now: number;
  visible: boolean;
  online: boolean;
}): 'fetch' | 'skip' {
  if (!input.visible || !input.online) return 'skip';
  if (input.reason === 'mount' || input.reason === 'resume') {
    return input.now - input.lastFetchedAt > PULSE_STALE_MS ? 'fetch' : 'skip';
  }
  return 'fetch';
}

/** How long a signal waits: the debounce plus a share of the jitter window (`random` in [0, 1)). */
export function signalDelayMs(random: number): number {
  const r = Number.isFinite(random) ? Math.min(Math.max(random, 0), 0.999_999) : 0;
  return SIGNAL_DEBOUNCE_MS + Math.floor(r * SIGNAL_JITTER_MS);
}

/** The payload → the snapshot. A malformed payload keeps the previous numbers. */
export function readPulsePayload(body: unknown, previous: PulseSnapshot, now: number): PulseSnapshot {
  const b = body as Partial<PulsePayload> | null | undefined;
  const total = b?.liveNow?.total;
  const unread = b?.unread?.messages;
  return {
    liveNow: typeof total === 'number' && total >= 0 ? total : previous.liveNow,
    unreadMessages: typeof unread === 'number' && unread >= 0 ? unread : previous.unreadMessages,
    fetchedAt: now,
  };
}

/** A local correction (a conversation read): never below zero. */
export function adjustUnread(snapshot: PulseSnapshot, delta: number): PulseSnapshot {
  if (!Number.isFinite(delta) || delta === 0) return snapshot;
  return { ...snapshot, unreadMessages: Math.max(0, snapshot.unreadMessages + Math.trunc(delta)) };
}
