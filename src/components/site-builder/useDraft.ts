'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SiteLayout } from '@/lib/site-builder/layout';
import {
  RATELIMIT_RETRY_MS,
  adoptRev as adoptRevState,
  beginSave,
  initialDraftState,
  settleSave,
  shouldRetryAfterRatelimit,
  shouldSave,
  type DraftState,
  type SaveOutcome,
} from '@/lib/site-builder/draft-state';

export type { DraftSaveStatus, SaveIssue, SaveOutcome } from '@/lib/site-builder/draft-state';

const DEBOUNCE_MS = 1500;

/**
 * Autosave — Site Builder P3-B, rebuilt in hardening H5 around the pure
 * `draft-state` core. Watches the layout the editor holds and, 1.5 s after
 * it last changed, PUTs it to the draft with the rev the editor last saw.
 * ONE save in flight at a time (an edit during a save waits and goes next);
 * a response for a save that is no longer in flight is ignored; `saved` is
 * the layout that was SENT, so an edit made mid-save stays dirty; a 429
 * retries itself once. The state in memory is the truth; the chip reflects
 * the wire. Nothing is saved until the FIRST edit.
 */
export function useDraft(layout: SiteLayout, save: (layout: SiteLayout, baseRev: number | null) => Promise<SaveOutcome>, initialRev: number | null) {
  // The ref is the authority (every writer sets both); the state only
  // re-renders. Refs are never touched during render (react-hooks/refs).
  const [state, setState] = useState<DraftState>(() => initialDraftState(layout, initialRev));
  const stateRef = useRef<DraftState>(state);
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);
  const initial = useRef(true);
  // Bumped when a settle should re-check for pending edits or a retry.
  const [tick, setTick] = useState(0);
  const timerRef = useRef<number | null>(null);

  const run = useCallback(
    async (target: SiteLayout) => {
      const begun = beginSave(stateRef.current, target);
      stateRef.current = begun;
      setState(begun);
      const outcome = await save(target, begun.rev);
      const settled = settleSave(stateRef.current, begun.seq, outcome, typeof navigator === 'undefined' || navigator.onLine);
      stateRef.current = settled;
      setState(settled);
      if (shouldRetryAfterRatelimit(settled)) window.setTimeout(() => setTick(t => t + 1), RATELIMIT_RETRY_MS);
      else setTick(t => t + 1);
    },
    [save]
  );

  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      return;
    }
    if (!shouldSave(stateRef.current, layout)) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void run(layoutRef.current);
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [layout, tick, run]);

  const dirty = layout !== state.saved;

  // The native leave prompt while an edit is unsaved (the SiteBlockEditor
  // beforeunload recipe; in-app navigation is not guarded).
  useEffect(() => {
    if (!dirty && state.status !== 'saving') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty, state.status]);

  /** A content save through the panel (set_hero, set_contact) writes the
   *  same draft and bumps its rev; the layout we hold is unchanged, so only
   *  the rev moves — the next autosave must carry it or it 409s. Only ever
   *  advances. */
  const adoptRev = useCallback((nextRev: number | null) => {
    const next = adoptRevState(stateRef.current, nextRev);
    stateRef.current = next;
    setState(next);
  }, []);

  /** Save NOW (skip the debounce) and resolve when the wire has answered —
   *  for an action that must see the draft the manager sees (H7: applying a
   *  design). Resolves at once when nothing is dirty; while a save is in
   *  flight it waits for that one and then saves the latest edit. */
  const flush = useCallback(async (): Promise<DraftState> => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // Wait out a save in flight (poll the ref — the settle clears it).
    while (stateRef.current.inFlight) await new Promise(r => setTimeout(r, 50));
    if (shouldSave(stateRef.current, layoutRef.current)) await run(layoutRef.current);
    return stateRef.current;
  }, [run]);

  return { status: state.status, rev: state.rev, issues: state.issues, dirty, adoptRev, flush, state };
}
