'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SUGGEST_DEBOUNCE_MS,
  SUGGEST_MIN_CHARS,
  cacheRead,
  cacheSet,
  createCache,
  findNarrowableEntry,
} from '@/lib/search/typeahead';

export interface UseTypeaheadOptions<T> {
  /**
   * Cache namespace. MUST encode the audience, not just the kind of thing
   * being searched: 'people:public' and 'people:mutual' return different rows
   * for the same query, and a mutual-audience result must never be served to
   * a public-audience surface.
   */
  scope: string;
  /** Runs on the debounced query. Abort via `signal`; throw to report failure. */
  fetcher: (query: string, signal: AbortSignal) => Promise<T[]>;
  /**
   * Local re-filter of a cached superset. Given results for a shorter query,
   * return those still matching the longer one. Omit to disable the
   * narrowing path (the cache still serves exact hits).
   */
  narrow?: (items: T[], query: string) => T[];
  /** Applied after fetching and after narrowing — excluded ids, self, etc. */
  filter?: (items: T[]) => T[];
  /** Page size the fetcher requests; used to detect a truncated result set. */
  limit?: number;
  minChars?: number;
  debounceMs?: number;
}

/**
 * One typeahead, everywhere. Debounce, abort, out-of-order protection, a
 * result cache with progressive narrowing, and listbox keyboard state.
 *
 * Keyboard contract matches `useMentionTypeahead`: call `onKeyDown(e)` FIRST
 * in your own handler and bail when it returns true, so Enter selects the
 * active option instead of submitting the form.
 */
export function useTypeahead<T>({
  scope,
  fetcher,
  narrow,
  filter,
  limit = 20,
  minChars = SUGGEST_MIN_CHARS,
  debounceMs = SUGGEST_DEBOUNCE_MS,
}: UseTypeaheadOptions<T>) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // useState, NOT useRef, and the lazy initialiser keeps the Map stable across
  // renders. The hook must READ this during render to paint a cached result in
  // the same frame as the keystroke, and this repo enforces the React Compiler
  // rule that refs may not be read during render (react-hooks/refs). State is
  // legal to read there; the render path uses the non-mutating `cacheRead`,
  // and only the effect ever writes.
  const [cache] = useState(() => createCache<T>());

  const applyFilter = useCallback((rows: T[]) => (filter ? filter(rows) : rows), [filter]);

  // ── Render-phase synchronisation ─────────────────────────────────────────
  // Everything that can be known WITHOUT the network is settled here rather
  // than in an effect: results land in the same frame as the keystroke (no
  // blank flash between them), and the hook stays clear of
  // react-hooks/set-state-in-effect, which is an ERROR in this repo.
  const [syncedQuery, setSyncedQuery] = useState(query);
  if (syncedQuery !== query) {
    setSyncedQuery(query);
    setActiveIndex(0);

    const trimmed = query.trim();
    const key = trimmed.toLowerCase();

    if (trimmed.length < minChars) {
      setItems([]);
      setLoading(false);
      setFailed(false);
    } else {
      const exact = cacheRead(cache, key);
      if (exact) {
        // Known answer — paint it and skip the request entirely.
        setItems(applyFilter(exact.items));
        setLoading(false);
        setFailed(false);
      } else {
        const wider = narrow ? findNarrowableEntry(cache, key) : null;
        if (wider) {
          // Narrow a complete superset locally now; the effect still fetches
          // to confirm. Typing forward through a name never goes blank.
          setItems(applyFilter(narrow!(wider.items, trimmed)));
        }
        // Previous results stay on screen while loading — never flash
        // "No results" at someone mid-word.
        setLoading(true);
        setFailed(false);
      }
    }
  }

  // ── The effect owns ONLY the network ─────────────────────────────────────
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < minChars) return;

    const key = trimmed.toLowerCase();
    if (cacheRead(cache, key)) return; // already served during render

    const seq = ++seqRef.current;
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const rows = await fetcher(trimmed, controller.signal);
        // Sequence guard AND abort cover different windows: abort stops the
        // request, the counter drops a response that resolved just before it.
        if (seq !== seqRef.current) return;
        cacheSet(cache, key, { items: rows, truncated: rows.length >= limit });
        setItems(applyFilter(rows));
        setFailed(false);
      } catch (err) {
        if (seq !== seqRef.current) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // Surfaced, not swallowed: "search is broken" must not look like
        // "no matches". That confusion is what hid the original bug.
        console.error(`[typeahead:${scope}] search failed`, err);
        setFailed(true);
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [query, minChars, debounceMs, limit, scope, fetcher, applyFilter, cache]);

  // Abort any in-flight request when the consumer unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    seqRef.current++;
    abortRef.current?.abort();
    setQuery('');
    setItems([]);
    setLoading(false);
    setFailed(false);
    setActiveIndex(0);
  }, []);

  /** Returns true when the event was consumed by the listbox. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (items.length === 0) return false;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex(i => (i + 1) % items.length);
          return true;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex(i => (i - 1 + items.length) % items.length);
          return true;
        case 'Home':
          e.preventDefault();
          setActiveIndex(0);
          return true;
        case 'End':
          e.preventDefault();
          setActiveIndex(items.length - 1);
          return true;
        default:
          return false;
      }
    },
    [items.length]
  );

  return {
    query,
    setQuery,
    items,
    loading,
    /** The request errored — show a failure state, NOT "no results". */
    failed,
    activeIndex,
    setActiveIndex,
    onKeyDown,
    reset,
  };
}
