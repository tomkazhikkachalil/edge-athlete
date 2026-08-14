/**
 * Typeahead shared vocabulary: the timing constants every search box in the
 * app now agrees on, plus a pure result cache.
 *
 * Before this, eleven surfaces hand-rolled the same `setTimeout` in an effect
 * with five different delays (0 / 250 / 300 / 400 / 500 ms) and four different
 * minimum lengths. The 0 ms ones were golf course pickers firing a network
 * request per keystroke; the 300 ms ones were everything else.
 */

/**
 * Why 120 ms.
 *
 * The perceived budget is `debounce + round-trip + render`. An indexed prefix
 * query (migration 087) round-trips in roughly 40-120 ms, so a 300 ms debounce
 * put the total at 350-450 ms — over the threshold where a UI stops feeling
 * responsive, which combined with the 2-character floor is why search read as
 * broken. At 120 ms the total lands around 160-240 ms.
 *
 * It is also still above the floor where debouncing stops doing its job:
 * inter-keystroke intervals for a fast typist cluster around 150-250 ms, so
 * 120 ms still collapses a burst while firing between deliberate keys — which
 * is exactly when someone is looking at the dropdown.
 *
 * The bigger win is the cache below: a hit renders in the same frame as the
 * keystroke, with no request at all.
 */
export const SUGGEST_DEBOUNCE_MS = 120;

/** Suggestions start at the first character. */
export const SUGGEST_MIN_CHARS = 1;

/** Enough to cover a long typing session; small enough to stay cheap. */
export const CACHE_MAX_ENTRIES = 60;

export interface CacheEntry<T> {
  items: T[];
  /**
   * The server returned a full page, so there may be more matches it did not
   * send. Load-bearing — see `findNarrowableEntry`.
   */
  truncated: boolean;
}

/** Insertion-ordered, which is what makes the eviction below work. */
export type TypeaheadCache<T> = Map<string, CacheEntry<T>>;

export function createCache<T>(): TypeaheadCache<T> {
  return new Map();
}

/**
 * Read WITHOUT mutating — no recency bookkeeping, deliberately.
 *
 * The hook consults the cache during render (that is the whole point: results
 * appear in the same frame as the keystroke), and a render-phase read must be
 * pure. So eviction is insertion-ordered rather than least-recently-used. For
 * a typing session, where every entry is minutes old at most, the difference
 * is not worth an impure read.
 */
export function cacheRead<T>(cache: TypeaheadCache<T>, key: string): CacheEntry<T> | undefined {
  return cache.get(key);
}

/** Write, evicting the oldest entry once over capacity. Effects only. */
export function cacheSet<T>(cache: TypeaheadCache<T>, key: string, entry: CacheEntry<T>): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, entry);
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/**
 * The longest cached entry whose key is a PREFIX of `key` and which was NOT
 * truncated — i.e. a complete result set that the current query can only
 * narrow, never extend.
 *
 * This is what makes typing feel instant: having fetched "to", the results for
 * "tom" can be filtered out of it locally and painted in the same frame, while
 * the real request is still in flight.
 *
 * The `truncated` guard is the correctness rule and the easy thing to get
 * wrong. If "t" came back capped at 20 rows, the match for "tom" may be one of
 * the rows the server never sent — narrowing that set locally would confidently
 * show a WRONG, short list. Only complete sets can be narrowed.
 */
export function findNarrowableEntry<T>(
  cache: TypeaheadCache<T>,
  key: string
): CacheEntry<T> | null {
  let best: CacheEntry<T> | null = null;
  let bestLen = -1;
  for (const [cachedKey, entry] of cache) {
    if (entry.truncated) continue;
    if (cachedKey.length >= key.length) continue;
    if (!key.startsWith(cachedKey)) continue;
    if (cachedKey.length > bestLen) {
      best = entry;
      bestLen = cachedKey.length;
    }
  }
  return best;
}
