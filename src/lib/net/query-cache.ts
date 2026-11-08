'use client';

/**
 * The client read cache (performance program, Phase 2 — Nov 2026): ONE
 * module-level store for the JSON a page reads, in the pulse-store shape the
 * project already has (src/lib/pulse/pulse-store.ts, hooks/useDrafts.ts) and
 * generalised: keyed by URL (or any string), stale-while-revalidate, in-flight
 * dedupe, subscribers per key, prefix invalidation, a reset on sign-out. The
 * rules live in query-cache-rules.ts; this file is the mechanism.
 *
 *   const { data, loading, refresh } = useCachedJson<Feed>('/api/posts?limit=20', { staleMs: 30_000 });
 *   await readCached('/api/live-now', () => fetchJson('/api/live-now'), { staleMs: 10_000 });
 *   invalidate('/api/posts');           // after a post is created or deleted
 *   resetQueryCache();                  // sign-out
 *
 * Only GET-shaped reads belong here. A writer never reads through the cache
 * to decide anything (the server decides); it writes, then invalidates.
 */

import { useEffect, useState } from 'react';
import { DEFAULT_STALE_MS, evictionOrder, matchesPrefix, planRead, type CacheEntry } from './query-cache-rules';

type Listener<T> = (value: T) => void;

const entries = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();
const listeners = new Map<string, Set<Listener<unknown>>>();

function publish<T>(key: string, value: T): void {
  entries.set(key, { value, at: Date.now() });
  for (const k of evictionOrder([...entries.entries()])) {
    entries.delete(k);
  }
  const set = listeners.get(key);
  if (set) for (const fn of set) fn(value);
}

/** The cached value for a key, whatever its age (undefined when none). */
export function peekCached<T>(key: string): T | undefined {
  return entries.get(key)?.value as T | undefined;
}

/**
 * Read through the cache. Resolves with the cached value at once when it is
 * young enough (and refetches behind it when it is not); fetches when there
 * is nothing. A fetch already in flight for the key is shared.
 */
export function readCached<T>(key: string, fetcher: () => Promise<T>, opts: { staleMs?: number; force?: boolean } = {}): Promise<T> {
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const entry = entries.get(key) as CacheEntry<T> | undefined;
  const plan = planRead(entry, Date.now(), staleMs, opts.force);
  if (plan === 'serve' && entry) return Promise.resolve(entry.value);
  const pending = startFetch(key, fetcher);
  if (plan === 'serve-and-revalidate' && entry) return Promise.resolve(entry.value);
  return pending;
}

function startFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = fetcher()
    .then((value) => {
      publish(key, value);
      return value;
    })
    .finally(() => {
      if (inFlight.get(key) === p) inFlight.delete(key);
    });
  inFlight.set(key, p);
  return p;
}

/** Forget every key under a prefix (`/api/posts` forgets the feed's pages). Subscribers are not told; the next read refetches. */
export function invalidate(prefix: string): void {
  for (const key of [...entries.keys()]) if (matchesPrefix(key, prefix)) entries.delete(key);
}

/** Forget everything — sign-out, a different account. */
export function resetQueryCache(): void {
  entries.clear();
  inFlight.clear();
}

/** Put a value in by hand (an optimistic write, a server answer another call already carried). */
export function primeCached<T>(key: string, value: T): void {
  publish(key, value);
}

/** A non-2xx answer: the status and whatever JSON body it carried (so the cache never holds an error page, and a caller can still read it). */
export class HttpError extends Error {
  constructor(public readonly url: string, public readonly status: number, public readonly body: unknown) {
    super(`${url}: ${status}`);
    this.name = 'HttpError';
  }
}
export const httpStatus = (e: unknown): number | null => (e instanceof HttpError ? e.status : null);

/** The JSON of a same-origin GET, or a thrown HttpError on a non-2xx. */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init });
  if (!res.ok) throw new HttpError(url, res.status, await res.json().catch(() => null));
  return (await res.json()) as T;
}

export interface CachedJson<T> {
  data: T | undefined;
  /** No value yet, a fetch in flight (false while a stale value is shown and revalidated). */
  loading: boolean;
  error: Error | null;
  /** Fetch again now; the stale value stays on screen until the answer lands. */
  refresh: () => Promise<void>;
}

/**
 * A component's read through the cache: paints the cached value at once,
 * revalidates when stale, follows later answers for the same key. `key`
 * null = disabled (nothing fetched, `data` undefined).
 */
export function useCachedJson<T>(key: string | null, opts: { staleMs?: number; fetcher?: () => Promise<T> } = {}): CachedJson<T> {
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const [data, setData] = useState<T | undefined>(() => (key ? peekCached<T>(key) : undefined));
  const [loading, setLoading] = useState<boolean>(() => !!key && peekCached<T>(key) === undefined);
  const [error, setError] = useState<Error | null>(null);
  const fetcher = opts.fetcher;

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const run = fetcher ?? (() => fetchJson<T>(key));
    const set = listeners.get(key) ?? new Set();
    listeners.set(key, set);
    const onValue: Listener<unknown> = (v) => {
      if (cancelled) return;
      setData(v as T);
      setLoading(false);
      setError(null);
    };
    set.add(onValue);
    const cached = peekCached<T>(key);
    if (cached !== undefined) onValue(cached);
    readCached(key, run, { staleMs }).catch((e: unknown) => {
      if (cancelled) return;
      setError(e instanceof Error ? e : new Error(String(e)));
      setLoading(false);
    });
    return () => {
      cancelled = true;
      set.delete(onValue);
      if (set.size === 0) listeners.delete(key);
    };
    // The fetcher is identified by the key: a new key is a new read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, staleMs]);

  const refresh = async () => {
    if (!key) return;
    const run = fetcher ?? (() => fetchJson<T>(key));
    try {
      await readCached(key, run, { staleMs, force: true });
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  };

  return { data, loading, error, refresh };
}
