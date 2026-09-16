/**
 * The stat outbox (Events program, phase 4) — the golf score outbox
 * generalized: ONE desired state per LINE (the whole stats object, the
 * version last seen), overwritten in place, flushed one at a time in
 * queue order; a 409 carries the line as the server holds it and the
 * recorder decides (keep mine = resend against the current version — a
 * real CAS, never a forced overwrite; keep theirs = drop + refetch).
 * `classifyResponse` / `backoffMs` are the golf outbox's, unchanged.
 */
import { backoffMs, type OutboxState } from '@/lib/golf/score-outbox';
import type { StatValues } from './stats';

export { backoffMs, classifyResponse } from '@/lib/golf/score-outbox';

export interface StatCurrentRow {
  version: number;
  stats: StatValues;
}

export interface StatOutboxEntry {
  lineId: string;
  stats: StatValues;
  /** The line's version the client last saw (0 = a fresh line). */
  expectedVersion: number;
  queuedAt: number;
  attempts: number;
  state: OutboxState;
  error?: string;
  /** On a conflict: the line as the server holds it now (null = the row is gone). */
  current?: StatCurrentRow | null;
}

export interface StatOutbox {
  v: 1;
  roundId: string;
  savedAt: number;
  entries: StatOutboxEntry[];
}

export const STAT_OUTBOX_TTL_MS = 48 * 60 * 60 * 1000;

export function statOutboxKey(roundId: string): string {
  return `ea:stat-outbox:v1:${roundId}`;
}

export function upsertStatEntry(entries: StatOutboxEntry[], entry: Omit<StatOutboxEntry, 'queuedAt' | 'attempts' | 'state'> & Partial<Pick<StatOutboxEntry, 'queuedAt' | 'attempts' | 'state'>>, now: number = Date.now()): StatOutboxEntry[] {
  const next: StatOutboxEntry = { queuedAt: now, attempts: 0, state: 'pending', ...entry };
  const rest = entries.filter(e => e.lineId !== entry.lineId);
  return [...rest, next];
}

export function removeStatEntry(entries: StatOutboxEntry[], lineId: string): StatOutboxEntry[] {
  return entries.filter(e => e.lineId !== lineId);
}

export function markStatEntry(entries: StatOutboxEntry[], lineId: string, patch: Partial<StatOutboxEntry>): StatOutboxEntry[] {
  return entries.map(e => (e.lineId === lineId ? { ...e, ...patch } : e));
}

export function parseStatOutbox(raw: string | null, roundId: string, now: number = Date.now()): StatOutboxEntry[] {
  if (!raw) return [];
  try {
    const box = JSON.parse(raw) as Partial<StatOutbox>;
    if (!box || box.v !== 1 || box.roundId !== roundId || !Array.isArray(box.entries)) return [];
    if (typeof box.savedAt !== 'number' || now - box.savedAt > STAT_OUTBOX_TTL_MS) return [];
    return box.entries.filter(e => e && typeof e.lineId === 'string' && e.stats && typeof e.stats === 'object' && typeof e.expectedVersion === 'number');
  } catch {
    return [];
  }
}

export function serializeStatOutbox(roundId: string, entries: StatOutboxEntry[], now: number = Date.now()): string {
  const box: StatOutbox = { v: 1, roundId, savedAt: now, entries };
  return JSON.stringify(box);
}

export function readStatOutbox(roundId: string, now: number = Date.now()): StatOutboxEntry[] {
  try {
    return parseStatOutbox(window.localStorage.getItem(statOutboxKey(roundId)), roundId, now);
  } catch {
    return [];
  }
}

export function writeStatOutbox(roundId: string, entries: StatOutboxEntry[]): void {
  try {
    if (entries.length === 0) window.localStorage.removeItem(statOutboxKey(roundId));
    else window.localStorage.setItem(statOutboxKey(roundId), serializeStatOutbox(roundId, entries));
  } catch { /* storage full / private mode: the state copy still drives the flush */ }
}

/** The lines as the screen shows them: a pending entry's stats over the server's. */
export function overlayStats<T extends { id: string; stats: StatValues }>(lines: T[], entries: StatOutboxEntry[]): T[] {
  if (entries.length === 0) return lines;
  const byLine = new Map(entries.map(e => [e.lineId, e]));
  return lines.map(l => {
    const e = byLine.get(l.id);
    return e ? { ...l, stats: e.stats } : l;
  });
}

/** The line's sync state: saved (no entry), pending, conflict, error. */
export function lineState(entries: StatOutboxEntry[], lineId: string): 'saved' | OutboxState {
  const e = entries.find(x => x.lineId === lineId);
  return e ? e.state : 'saved';
}

/** The next pending entry to send, in queue order, honouring the backoff. */
export function nextStatToFlush(entries: StatOutboxEntry[], now: number = Date.now()): StatOutboxEntry | null {
  const pending = entries.filter(e => e.state === 'pending').sort((a, b) => a.queuedAt - b.queuedAt);
  for (const e of pending) {
    const due = e.attempts === 0 || now - e.queuedAt >= backoffMs(e.attempts);
    if (due) return e;
  }
  return null;
}
