// ── "Post to feed" — remembered per kind on this device (Tom, Oct 19 2026) ──
// The feed is a SWITCH (posts.on_feed, 269), never an audience: the account
// decides who sees a post; this only decides whether it also goes on the
// feed. Defaults ON. Someone who keeps their runs off the feed does not want
// to flip it every time, so the last choice is kept per KIND — a sport
// result, an activity, a workout (training) — the way "Hide timer" is kept
// (timer-prefs.ts). localStorage, fail-open: a private window or blocked
// storage means ON. A guardian acting for an athlete shares the device's
// habit — it is a habit of the hand, not of the account. ZERO imports.

export type FeedKind = 'sport' | 'activity' | 'workout';

export const FEED_MEMORY_KEY = 'ea:post:feed:v1';

type Stored = Partial<Record<FeedKind, boolean>>;

function readAll(storage: Pick<Storage, 'getItem'> | null): Stored {
  try {
    const raw = storage?.getItem(FEED_MEMORY_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Stored = {};
    for (const k of ['sport', 'activity', 'workout'] as const) {
      const v = (parsed as Record<string, unknown>)[k];
      if (typeof v === 'boolean') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** The switch's starting position for this kind: the last choice, else ON. */
export function readFeedDefault(kind: FeedKind, storage: Pick<Storage, 'getItem'> | null = defaultStorage()): boolean {
  const v = readAll(storage)[kind];
  return v === undefined ? true : v;
}

/** Keep the choice for next time (best-effort). */
export function rememberFeedChoice(kind: FeedKind, on: boolean, storage: Pick<Storage, 'getItem' | 'setItem'> | null = defaultStorage()): void {
  try {
    if (!storage) return;
    const next: Stored = { ...readAll(storage), [kind]: on };
    storage.setItem(FEED_MEMORY_KEY, JSON.stringify(next));
  } catch {
    /* best-effort */
  }
}
