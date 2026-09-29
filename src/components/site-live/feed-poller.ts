// ── ONE poller per feed URL (sports-team website program, V2) ───────────────
// Every live card on a page subscribes here; the page makes one request per
// tick however many cards it shows. Rules live in live-poll.ts (pure): the
// server's pollMs, jitter, backoff on failure, never an older feed; the tab
// hidden → no requests (resume at once when it shows again); AbortController
// only (AbortSignal.timeout is past the iOS 15 floor). Same-origin fetch of a
// RELATIVE path — no credentials needed, none sent beyond the browser default.

import { FIRST_POLL_MS, mergeFeed, nextDelay } from '@/lib/org-sites/live-poll';
import type { LiveFeed } from '@/lib/org-sites/live-feed';

type Listener = (feed: LiveFeed) => void;

interface Poller {
  listeners: Set<Listener>;
  feed: LiveFeed | null;
  failures: number;
  timer: ReturnType<typeof setTimeout> | null;
  abort: AbortController | null;
  auto: boolean;
  stopped: boolean;
}

const pollers = new Map<string, Poller>();
const REQUEST_TIMEOUT_MS = 10_000;

function hidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

async function tick(url: string, p: Poller): Promise<void> {
  p.timer = null;
  if (p.listeners.size === 0) return;
  if (hidden()) return; // resumed by the visibility listener
  const ctrl = new AbortController();
  p.abort = ctrl;
  const killer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let delay: number | null;
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(String(res.status));
    const incoming = (await res.json()) as LiveFeed;
    p.feed = mergeFeed(p.feed, incoming);
    p.failures = 0;
    for (const l of p.listeners) l(p.feed);
    delay = nextDelay(p.feed.pollMs, 0, Math.random());
  } catch {
    if (ctrl.signal.aborted && p.listeners.size === 0) return;
    p.failures += 1;
    delay = nextDelay(0, p.failures, Math.random());
  } finally {
    clearTimeout(killer);
    p.abort = null;
  }
  if (delay === null) {
    p.stopped = true;
    return;
  }
  if (p.auto && p.listeners.size > 0) p.timer = setTimeout(() => void tick(url, p), delay);
}

function onVisibility(): void {
  if (hidden()) return;
  for (const [url, p] of pollers) {
    if (p.auto && !p.stopped && !p.timer && !p.abort && p.listeners.size > 0) p.timer = setTimeout(() => void tick(url, p), 0);
  }
}

let visibilityBound = false;

/** Subscribe a card; returns the unsubscribe. `auto` false (Save-Data) =
 *  no automatic requests — `refreshNow` is the card's button. */
export function subscribeFeed(url: string, listener: Listener, auto: boolean): () => void {
  let p = pollers.get(url);
  if (!p) {
    p = { listeners: new Set(), feed: null, failures: 0, timer: null, abort: null, auto, stopped: false };
    pollers.set(url, p);
    if (auto) p.timer = setTimeout(() => void tick(url, p!), FIRST_POLL_MS + Math.round(Math.random() * 1_000));
  }
  p.listeners.add(listener);
  if (p.feed) listener(p.feed);
  if (!visibilityBound && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
    visibilityBound = true;
  }
  return () => {
    const cur = pollers.get(url);
    if (!cur) return;
    cur.listeners.delete(listener);
    if (cur.listeners.size === 0) {
      if (cur.timer) clearTimeout(cur.timer);
      cur.abort?.abort();
      pollers.delete(url);
    }
  };
}

/** One request now (the Save-Data Refresh button). */
export function refreshNow(url: string): void {
  const p = pollers.get(url);
  if (!p || p.abort) return;
  if (p.timer) clearTimeout(p.timer);
  p.stopped = false;
  void tick(url, p);
}
