'use client';

import { useCallback, useMemo } from 'react';
import { useTypeahead } from './useTypeahead';
import { rankPeople, type PersonSuggestion } from '@/lib/search/people';
import { SUGGEST_MIN_CHARS } from '@/lib/search/typeahead';

// Headless people-search for the "start a conversation" flows, now a thin
// wrapper over useTypeahead so it shares one debounce, one cache and one set
// of keyboard semantics with every other search box in the app.
//
// Headless on purpose: the dock's 32px result rows and the board's 40px ones
// are different densities by design, so there is no shared JSX worth
// extracting, only the fetching.

/** Kept as an alias so existing imports of this name still resolve. */
export type SearchProfile = PersonSuggestion;

export interface UseProfileSearchOptions {
  /**
   * Below this the query is not sent and results are cleared. Defaults to 1 —
   * suggestions now start on the first keystroke, and the API returns an empty
   * result rather than a 400 for a query it considers too short.
   */
  minChars?: number;
  /** Usually the current user — filtered out client-side. */
  excludeId?: string;
  debounceMs?: number;
}

const LIMIT = 20;

export function useProfileSearch({
  minChars = SUGGEST_MIN_CHARS,
  excludeId,
  debounceMs,
}: UseProfileSearchOptions = {}) {
  const fetcher = useCallback(async (q: string, signal: AbortSignal) => {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&type=athletes`, { signal });
    if (!res.ok) throw new Error(`search failed: ${res.status}`);
    const data = await res.json();
    return (data.results?.athletes ?? []) as PersonSuggestion[];
  }, []);

  const filter = useCallback(
    (rows: PersonSuggestion[]) => (excludeId ? rows.filter(p => p.id !== excludeId) : rows),
    [excludeId]
  );

  const typeahead = useTypeahead<PersonSuggestion>({
    scope: 'people:public',
    fetcher,
    narrow: rankPeople,
    filter,
    limit: LIMIT,
    minChars,
    debounceMs,
  });

  // Preserves the original { query, setQuery, results, searching } contract.
  return useMemo(
    () => ({
      query: typeahead.query,
      setQuery: typeahead.setQuery,
      results: typeahead.items,
      searching: typeahead.loading,
      failed: typeahead.failed,
      activeIndex: typeahead.activeIndex,
      setActiveIndex: typeahead.setActiveIndex,
      onKeyDown: typeahead.onKeyDown,
      reset: typeahead.reset,
    }),
    [typeahead]
  );
}
