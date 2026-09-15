'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { flushEntry, keepaliveFlush } from '@/lib/golf/score-flush';
import { markEntry, nextToFlush, readOutbox, removeEntry, upsertEntry, writeOutbox, type OutboxEntry } from '@/lib/golf/score-outbox';

/**
 * The outbox as a hook (Events program, PR 14): the entries live in state
 * AND localStorage; `commit` enqueues + flushes; a flush drains one entry
 * at a time (sequential per participant, the queue order), on `online`,
 * on becoming visible, on a 15 s tick and after every commit; `pagehide`
 * fires the keepalive half. `onFlushed` lets the card refetch the server's
 * scorecard after a success so the overlay lifts.
 */
export function useScoreOutbox(groupPostId: string, onFlushed: () => void) {
  const [entries, setEntries] = useState<OutboxEntry[]>(() => (typeof window === 'undefined' ? [] : readOutbox(groupPostId)));
  const entriesRef = useRef(entries);
  const flushing = useRef(false);
  const onFlushedRef = useRef(onFlushed);
  useEffect(() => { onFlushedRef.current = onFlushed; }, [onFlushed]);

  const persist = useCallback((next: OutboxEntry[]) => {
    entriesRef.current = next;
    setEntries(next);
    writeOutbox(groupPostId, next);
  }, [groupPostId]);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      let anyDone = false;
      for (let guard = 0; guard < 64; guard++) {
        const e = nextToFlush(entriesRef.current);
        if (!e) break;
        const outcome = await flushEntry(e);
        if (outcome.kind === 'done') {
          persist(removeEntry(entriesRef.current, e.participantId, e.holeNumber));
          anyDone = true;
        } else if (outcome.kind === 'conflict') {
          persist(markEntry(entriesRef.current, e.participantId, e.holeNumber, { state: 'conflict', current: outcome.current }));
        } else if (outcome.kind === 'drop') {
          persist(markEntry(entriesRef.current, e.participantId, e.holeNumber, { state: 'error', error: outcome.error }));
        } else {
          persist(markEntry(entriesRef.current, e.participantId, e.holeNumber, { attempts: e.attempts + 1, queuedAt: Date.now(), error: outcome.error }));
          break; // offline or busy: stop this pass, the tick retries
        }
      }
      if (anyDone) onFlushedRef.current();
    } finally {
      flushing.current = false;
    }
  }, [persist]);

  const commit = useCallback((entry: Omit<OutboxEntry, 'queuedAt' | 'attempts' | 'state'>) => {
    persist(upsertEntry(entriesRef.current, entry));
    void flush();
  }, [persist, flush]);

  /** Keep mine: resend without the stamp. Keep theirs: drop the entry (the caller refetches). */
  const resolveConflict = useCallback(async (participantId: string, holeNumber: number, choice: 'mine' | 'theirs') => {
    const e = entriesRef.current.find(x => x.participantId === participantId && x.holeNumber === holeNumber);
    if (!e) return;
    if (choice === 'theirs') {
      persist(removeEntry(entriesRef.current, participantId, holeNumber));
      onFlushedRef.current();
      return;
    }
    const outcome = await flushEntry({ ...e, expectedUpdatedAt: null }, { force: true });
    if (outcome.kind === 'done') {
      persist(removeEntry(entriesRef.current, participantId, holeNumber));
      onFlushedRef.current();
    } else if (outcome.kind === 'drop') {
      persist(markEntry(entriesRef.current, participantId, holeNumber, { state: 'error', error: outcome.error }));
    } else {
      persist(markEntry(entriesRef.current, participantId, holeNumber, { state: 'pending', expectedUpdatedAt: null, attempts: 0, queuedAt: Date.now() }));
    }
  }, [persist]);

  const retry = useCallback((participantId: string, holeNumber: number) => {
    persist(markEntry(entriesRef.current, participantId, holeNumber, { state: 'pending', attempts: 0, queuedAt: Date.now(), error: undefined }));
    void flush();
  }, [persist, flush]);

  useEffect(() => {
    const onOnline = () => { void flush(); };
    const onVisible = () => { if (document.visibilityState === 'visible') void flush(); else keepaliveFlush(entriesRef.current); };
    const onHide = () => keepaliveFlush(entriesRef.current);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', onHide);
    const tick = window.setInterval(() => { void flush(); }, 15_000);
    void flush();
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onHide);
      window.clearInterval(tick);
    };
  }, [flush]);

  return { entries, commit, flush, resolveConflict, retry };
}
