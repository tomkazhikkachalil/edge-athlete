'use client';

import { useEffect, useRef, useState } from 'react';

// Headless people-search for the "start a conversation" flows. Debounce +
// out-of-order guard + the /api/search contract, in one place — it was about to
// exist a third time when the dock gained a group composer.
//
// Headless on purpose: the dock's 32px result rows and the board's 40px ones are
// different densities by design, so there is no shared JSX worth extracting,
// only the fetching.

export interface SearchProfile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  handle: string | null;
}

export interface UseProfileSearchOptions {
  /** Below this the query is not sent and results are cleared. The API itself
   *  400s under 2 characters. */
  minChars?: number;
  /** Usually the current user — filtered out client-side. */
  excludeId?: string;
  debounceMs?: number;
}

export function useProfileSearch({
  minChars = 2,
  excludeId,
  debounceMs = 300,
}: UseProfileSearchOptions = {}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const seqRef = useRef(0);

  // Clearing results for a too-short query is synchronisation (render phase);
  // the debounced fetch stays an effect.
  const [syncedQuery, setSyncedQuery] = useState(query);
  if (syncedQuery !== query) {
    setSyncedQuery(query);
    if (query.trim().length < minChars) setResults([]);
    else setSearching(true);
  }

  useEffect(() => {
    const q = query.trim();
    if (q.length < minChars) return;
    // Sequence guard: a slow early response must not overwrite a fast later one.
    const seq = ++seqRef.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&type=athletes`);
        if (!res.ok || seq !== seqRef.current) return;
        const data = await res.json();
        if (seq === seqRef.current) {
          const athletes = (data.results?.athletes ?? []) as SearchProfile[];
          setResults(excludeId ? athletes.filter(p => p.id !== excludeId) : athletes);
        }
      } catch {
        // typing again retries
      } finally {
        if (seq === seqRef.current) setSearching(false);
      }
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [query, minChars, excludeId, debounceMs]);

  return { query, setQuery, results, searching };
}
