'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { flushEntry, keepaliveFlush } from '@/lib/golf/score-flush';
import { entryKey, markEntry, nextToFlush, readOutbox, removeEntry, upsertEntry, writeOutbox, type OutboxEntry } from '@/lib/golf/score-outbox';

/**
 * The outbox as a hook (Events program, PR 14; per-hole CAS since phase
 * 2b): the entries live in state AND localStorage; `commit` enqueues +
 * flushes; a flush drains one entry at a time (sequential per
 * participant, the queue order), on `online`, on becoming visible, on a
 * 15 s tick and after every commit; `pagehide` fires the keepalive half.
 * `onFlushed` lets the card refetch the server's scorecard after a
 * success so the overlay lifts.
 *
 * Versions: a commit carries the hole's version the CARD showed; the hook
 * remembers the version each of ITS OWN saves produced (`known`) and
 * sends that instead when it is ahead of the card — a second commit on a
 * hole whose first save has landed but whose refetch has not must not
 * conflict with itself. Someone else's write still conflicts (their
 * version is unknown here), which is the point.
 */
export function useScoreOutbox(groupPostId: string, onFlushed: () => void) {
  const [entries, setEntries] = useState<OutboxEntry[]>(() => (typeof window === 'undefined' ? [] : readOutbox(groupPostId)));
  const entriesRef = useRef(entries);
  const flushing = useRef(false);
  const known = useRef(new Map<string, number>());
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
        const key = entryKey(e.participantId, e.holeNumber);
        const mine = known.current.get(key);
        const send = e.expectedVersion !== null && mine !== undefined && mine > e.expectedVersion ? { ...e, expectedVersion: mine } : e;
        const outcome = await flushEntry(send);
        if (outcome.kind === 'done') {
          if (outcome.version !== null) known.current.set(key, outcome.version);
          // A newer commit for the same hole may have replaced this entry mid-flight: keep that one.
          const still = entriesRef.current.find(x => entryKey(x.participantId, x.holeNumber) === key);
          if (still && still.queuedAt === e.queuedAt) persist(removeEntry(entriesRef.current, e.participantId, e.holeNumber));
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

  /**
   * Keep mine: resend AGAINST the version the conflict reported (a real
   * CAS — a third writer meanwhile conflicts again, never a forced
   * overwrite; a vanished row is re-inserted with 0). Keep theirs: drop
   * the entry and forget our version (the caller refetches).
   */
  const resolveConflict = useCallback(async (participantId: string, holeNumber: number, choice: 'mine' | 'theirs') => {
    const e = entriesRef.current.find(x => x.participantId === participantId && x.holeNumber === holeNumber);
    if (!e) return;
    const key = entryKey(participantId, holeNumber);
    if (choice === 'theirs') {
      known.current.delete(key);
      persist(removeEntry(entriesRef.current, participantId, holeNumber));
      onFlushedRef.current();
      return;
    }
    const expectedVersion = e.current ? e.current.version : 0;
    const outcome = await flushEntry({ ...e, expectedVersion });
    if (outcome.kind === 'done') {
      if (outcome.version !== null) known.current.set(key, outcome.version);
      persist(removeEntry(entriesRef.current, participantId, holeNumber));
      onFlushedRef.current();
    } else if (outcome.kind === 'conflict') {
      persist(markEntry(entriesRef.current, participantId, holeNumber, { state: 'conflict', current: outcome.current, expectedVersion }));
    } else if (outcome.kind === 'drop') {
      persist(markEntry(entriesRef.current, participantId, holeNumber, { state: 'error', error: outcome.error }));
    } else {
      persist(markEntry(entriesRef.current, participantId, holeNumber, { state: 'pending', expectedVersion, attempts: 0, queuedAt: Date.now() }));
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
