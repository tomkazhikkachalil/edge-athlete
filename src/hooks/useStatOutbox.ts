'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { flushStatEntry, keepaliveStatFlush } from '@/lib/sport-events/stat-flush';
import { markStatEntry, nextStatToFlush, readStatOutbox, removeStatEntry, upsertStatEntry, writeStatOutbox, type StatOutboxEntry } from '@/lib/sport-events/stat-outbox';

/**
 * The stat outbox as a hook (Events program, phase 4) — the golf
 * `useScoreOutbox` with ONE desired state per LINE: `commit` enqueues the
 * whole stats object + the version last seen and flushes; a flush drains
 * one entry at a time in queue order, on `online`, on becoming visible,
 * on a 15 s tick and after every commit; `pagehide` fires the keepalive
 * half. `known` keeps the versions this hook's own saves produced ahead
 * of the board's refetch, so a second tap on a line whose first save
 * landed never conflicts with itself; someone else's write still does.
 */
export function useStatOutbox(eventId: string, roundId: string, onFlushed: () => void) {
  const [entries, setEntries] = useState<StatOutboxEntry[]>(() => (typeof window === 'undefined' ? [] : readStatOutbox(roundId)));
  const entriesRef = useRef(entries);
  const flushing = useRef(false);
  const known = useRef(new Map<string, number>());
  const onFlushedRef = useRef(onFlushed);
  useEffect(() => { onFlushedRef.current = onFlushed; }, [onFlushed]);

  const persist = useCallback((next: StatOutboxEntry[]) => {
    entriesRef.current = next;
    setEntries(next);
    writeStatOutbox(roundId, next);
  }, [roundId]);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      let anyDone = false;
      for (let guard = 0; guard < 64; guard++) {
        const e = nextStatToFlush(entriesRef.current);
        if (!e) break;
        const mine = known.current.get(e.lineId);
        const send = mine !== undefined && mine > e.expectedVersion ? { ...e, expectedVersion: mine } : e;
        const outcome = await flushStatEntry(send, eventId, roundId);
        if (outcome.kind === 'done') {
          if (outcome.version !== null) known.current.set(e.lineId, outcome.version);
          const still = entriesRef.current.find(x => x.lineId === e.lineId);
          if (still && still.queuedAt === e.queuedAt) persist(removeStatEntry(entriesRef.current, e.lineId));
          anyDone = true;
        } else if (outcome.kind === 'conflict') {
          persist(markStatEntry(entriesRef.current, e.lineId, { state: 'conflict', current: outcome.current }));
        } else if (outcome.kind === 'drop') {
          persist(markStatEntry(entriesRef.current, e.lineId, { state: 'error', error: outcome.error }));
        } else {
          persist(markStatEntry(entriesRef.current, e.lineId, { attempts: e.attempts + 1, queuedAt: Date.now(), error: outcome.error }));
          break;
        }
      }
      if (anyDone) onFlushedRef.current();
    } finally {
      flushing.current = false;
    }
  }, [persist, eventId, roundId]);

  /** The version to send for a line: the board's, or this hook's own later save. */
  const versionFor = useCallback((lineId: string, seen: number) => {
    const mine = known.current.get(lineId);
    return mine !== undefined && mine > seen ? mine : seen;
  }, []);

  const commit = useCallback((lineId: string, stats: Record<string, number>, seenVersion: number) => {
    persist(upsertStatEntry(entriesRef.current, { lineId, stats, expectedVersion: versionFor(lineId, seenVersion) }));
    void flush();
  }, [persist, flush, versionFor]);

  /** Keep mine: resend AGAINST the version the conflict reported (a real CAS). Take theirs: drop the entry (the caller refetches). */
  const resolveConflict = useCallback(async (lineId: string, choice: 'mine' | 'theirs') => {
    const e = entriesRef.current.find(x => x.lineId === lineId);
    if (!e) return;
    if (choice === 'theirs') {
      known.current.delete(lineId);
      persist(removeStatEntry(entriesRef.current, lineId));
      onFlushedRef.current();
      return;
    }
    const expectedVersion = e.current ? e.current.version : 0;
    const outcome = await flushStatEntry({ ...e, expectedVersion }, eventId, roundId);
    if (outcome.kind === 'done') {
      if (outcome.version !== null) known.current.set(lineId, outcome.version);
      persist(removeStatEntry(entriesRef.current, lineId));
      onFlushedRef.current();
    } else if (outcome.kind === 'conflict') {
      persist(markStatEntry(entriesRef.current, lineId, { state: 'conflict', current: outcome.current, expectedVersion }));
    } else if (outcome.kind === 'drop') {
      persist(markStatEntry(entriesRef.current, lineId, { state: 'error', error: outcome.error }));
    } else {
      persist(markStatEntry(entriesRef.current, lineId, { state: 'pending', expectedVersion, attempts: 0, queuedAt: Date.now() }));
    }
  }, [persist, eventId, roundId]);

  const retry = useCallback((lineId: string) => {
    persist(markStatEntry(entriesRef.current, lineId, { state: 'pending', attempts: 0, queuedAt: Date.now(), error: undefined }));
    void flush();
  }, [persist, flush]);

  useEffect(() => {
    const onOnline = () => { void flush(); };
    const onVisible = () => { if (document.visibilityState === 'visible') void flush(); else keepaliveStatFlush(entriesRef.current, eventId, roundId); };
    const onHide = () => keepaliveStatFlush(entriesRef.current, eventId, roundId);
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
  }, [flush, eventId, roundId]);

  return { entries, commit, flush, resolveConflict, retry, versionFor };
}
