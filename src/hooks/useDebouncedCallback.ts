'use client';

import { useCallback, useEffect, useRef } from 'react';
import { SUGGEST_DEBOUNCE_MS } from '@/lib/search/typeahead';

/**
 * Debounce an async callback that is invoked directly from an event handler.
 *
 * For a search box you own end to end, prefer `useTypeahead` — it also brings
 * caching, ranking and keyboard navigation. This is the smaller tool for
 * inputs whose value is already owned by a surrounding form, where the search
 * is a side effect of typing rather than the input's purpose. The golf course
 * pickers are exactly that: `courseName` is form state that doubles as the
 * query, so they called fetch straight out of `onChange` with no debounce at
 * all — one network request per keystroke.
 *
 * The callback receives an AbortSignal; a newer call aborts the previous one.
 */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (signal: AbortSignal, ...args: A) => void | Promise<void>,
  delayMs: number = SUGGEST_DEBOUNCE_MS
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fnRef = useRef(fn);

  // Keep the latest closure without making the returned function unstable —
  // it is used in event handlers and often lands in dependency arrays.
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    },
    []
  );

  return useCallback(
    (...args: A) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        void fnRef.current(controller.signal, ...args);
      }, delayMs);
    },
    [delayMs]
  );
}
