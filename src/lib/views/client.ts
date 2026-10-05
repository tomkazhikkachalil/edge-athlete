// ── Impact beacon, the client half (252) ──────────────────────────────────
// A card that was half on screen for a second, or a video that played for
// 3 s, records ONE (post, kind) per tab per UTC day; the queue flushes after
// 2 s, at 50 items, and when the page hides — a `keepalive` POST the server
// answers 204 to whatever happens. Nothing here throws. The pure parts
// (the key, the batching) are pinned in __tests__/views-client.test.ts.

import type { ViewKind } from './hash';

export const FLUSH_AFTER_MS = 2000;
export const FLUSH_AT = 50;

export function viewKey(postId: string, kind: ViewKind, day: string): string {
  return `${postId}:${kind}:${day}`;
}

export function todayUTC(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

type Sender = (items: { id: string; kind: ViewKind }[]) => void;

/** The queue, with an injectable sender and clock for tests. */
export function createViewQueue(send: Sender, schedule: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms), now: () => Date = () => new Date()) {
  const sent = new Set<string>();
  let pending: { id: string; kind: ViewKind }[] = [];
  let timer: unknown = null;

  const flush = () => {
    timer = null;
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    try {
      send(batch);
    } catch {
      /* a beacon never throws */
    }
  };

  const record = (postId: string, kind: ViewKind): boolean => {
    const key = viewKey(postId, kind, todayUTC(now()));
    if (sent.has(key)) return false;
    sent.add(key);
    pending.push({ id: postId, kind });
    if (pending.length >= FLUSH_AT) {
      flush();
    } else if (timer === null) {
      timer = schedule(flush, FLUSH_AFTER_MS);
    }
    return true;
  };

  return { record, flush, pendingCount: () => pending.length };
}

function post(items: { id: string; kind: ViewKind }[]): void {
  if (typeof fetch !== 'function') return;
  void fetch('/api/posts/views', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
    keepalive: true,
  }).catch(() => {});
}

let queue: ReturnType<typeof createViewQueue> | null = null;

function live(): ReturnType<typeof createViewQueue> {
  if (queue) return queue;
  queue = createViewQueue(post);
  if (typeof window !== 'undefined') {
    const q = queue;
    window.addEventListener('pagehide', () => q.flush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') q.flush();
    });
  }
  return queue;
}

/** Record that THIS tab saw `postId` (or played its video) — once per day. */
export function recordView(postId: string, kind: ViewKind): void {
  try {
    live().record(postId, kind);
  } catch {
    /* never */
  }
}
