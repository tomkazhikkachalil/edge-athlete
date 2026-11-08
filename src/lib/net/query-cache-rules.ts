/**
 * The client read cache's RULES (performance program, Phase 2 — Nov 2026).
 * Pure, zero imports; the store (query-cache.ts) applies them and
 * src/lib/__tests__/query-cache-rules.test.ts pins them.
 *
 * WHY A CACHE. Every page used to start its reads from nothing: coming back
 * to the feed from a profile refetched the first page and showed a spinner
 * over data the tab had ten seconds ago; the header refetched the workout
 * routines on EVERY navigation; and on a phone right after a deploy each of
 * those requests could land on a cold function (docs/load/2026-11-07/
 * cold-after-warm.md — a burst of parallel first requests spawns parallel
 * cold instances). A read the tab already holds is answered at once and
 * revalidated in the background when it is older than its `staleMs`; a
 * read in flight is shared, never duplicated.
 *
 * What it is NOT: a source of truth. A writer that changes what a key
 * answers calls `invalidate(prefix)`; the pulse's signals do the same for
 * the lists they govern; sign-out clears everything.
 */

export interface CacheEntry<T> {
  value: T;
  /** When the value was fetched (ms since epoch). */
  at: number;
}

export type ReadPlan = 'serve' | 'serve-and-revalidate' | 'fetch';

/** A read's default lifetime: ten seconds covers a back-navigation; a list the pulse governs says so itself. */
export const DEFAULT_STALE_MS = 10_000;
/** The store never holds more than this many keys (the oldest go first). */
export const MAX_ENTRIES = 200;

/**
 * What a read does with what it finds: nothing cached → fetch; cached and
 * young → serve; cached and older than `staleMs` → serve it NOW and refetch
 * behind it. `force` always fetches (a pull-to-refresh) but still serves
 * the stale value meanwhile.
 */
export function planRead(entry: CacheEntry<unknown> | undefined, now: number, staleMs: number, force = false): ReadPlan {
  if (!entry) return 'fetch';
  if (force) return 'serve-and-revalidate';
  return now - entry.at <= Math.max(0, staleMs) ? 'serve' : 'serve-and-revalidate';
}

/** `invalidate('/api/posts')` forgets `/api/posts`, `/api/posts?limit=20`, `/api/posts/abc` — a prefix, never a regex. */
export function matchesPrefix(key: string, prefix: string): boolean {
  return key === prefix || key.startsWith(prefix);
}

/** Which keys to drop when the store is full: the oldest `at` first, until it fits. */
export function evictionOrder(entries: ReadonlyArray<[string, CacheEntry<unknown>]>, max = MAX_ENTRIES): string[] {
  if (entries.length <= max) return [];
  return [...entries]
    .sort((a, b) => a[1].at - b[1].at)
    .slice(0, entries.length - max)
    .map(([key]) => key);
}
