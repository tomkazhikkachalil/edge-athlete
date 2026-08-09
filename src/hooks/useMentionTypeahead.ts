'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { findActiveMentionToken, spliceMention } from '@/lib/mentions';

export interface MentionCandidate {
  id: string;
  handle: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
}

interface Options {
  /** The controlled value of the textarea. */
  value: string;
  /** Setter for the controlled value. */
  setValue: (next: string) => void;
  /** The textarea being watched (caret reads + focus restore). */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /**
   * Candidate source. Async results are sequence-guarded — out-of-order
   * responses are dropped (useProfileSearch's pattern).
   */
  getCandidates: (query: string) => MentionCandidate[] | Promise<MentionCandidate[]>;
  /**
   * Sync sources (chat: local participant filter) resolve immediately with
   * no debounce; async sources (comments: /api/mentions/search) debounce
   * before the request fires.
   */
  sync?: boolean;
  debounceMs?: number;
}

/**
 * Inline @mention typeahead for a textarea. Watches the caret for an active
 * @token, surfaces candidates, and splices the chosen handle back in.
 *
 * Keyboard contract: consumers call `onKeyDown(e)` FIRST in their own
 * keydown handler and bail when it returns true — while the dropdown is
 * open it owns ArrowUp/Down (move), Enter/Tab (select) and Escape (close),
 * so Enter must not fall through to send-the-message.
 */
export function useMentionTypeahead({
  value,
  setValue,
  textareaRef,
  getCandidates,
  sync = false,
  debounceMs = 250,
}: Options) {
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<MentionCandidate[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const tokenRef = useRef<{ start: number; query: string } | null>(null);
  const seqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setCandidates([]);
    setActiveIndex(0);
    tokenRef.current = null;
  }, []);

  // Re-evaluate the active token whenever the value changes. Caret position
  // is read from the textarea AFTER the change event (selectionStart is
  // already updated when React's onChange fires).
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const token = findActiveMentionToken(value, ta.selectionStart ?? value.length);
    tokenRef.current = token;
    if (!token) {
      close();
      return;
    }
    const seq = ++seqRef.current;
    if (timerRef.current) clearTimeout(timerRef.current);
    const run = async () => {
      const result = await getCandidates(token.query);
      if (seq !== seqRef.current) return; // stale response
      setCandidates(result);
      setActiveIndex(0);
      setOpen(result.length > 0);
    };
    if (sync) {
      void run(); // resolves in the same tick for array-returning sources
    } else {
      timerRef.current = setTimeout(run, debounceMs);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const select = useCallback(
    (candidate: MentionCandidate) => {
      const ta = textareaRef.current;
      const token = tokenRef.current;
      if (!ta || !token) return;
      const caret = ta.selectionStart ?? value.length;
      const next = spliceMention(value, token.start, caret, candidate.handle);
      setValue(next.text);
      close();
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(next.caret, next.caret);
      });
    },
    [value, setValue, textareaRef, close]
  );

  /** Returns true when the event was consumed by the dropdown. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!open) return false;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % candidates.length);
          return true;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((i) => (i - 1 + candidates.length) % candidates.length);
          return true;
        case 'Enter':
        case 'Tab':
          e.preventDefault();
          if (candidates[activeIndex]) select(candidates[activeIndex]);
          return true;
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          close();
          return true;
        default:
          return false;
      }
    },
    [open, candidates, activeIndex, select, close]
  );

  return { open, candidates, activeIndex, setActiveIndex, select, close, onKeyDown };
}
