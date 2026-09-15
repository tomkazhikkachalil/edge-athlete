/**
 * The score outbox (Events program, PR 14) — pure core + the localStorage
 * pattern of score-entry.ts. A live group card enters holes on a course
 * where the signal comes and goes; every commit lands here first, as a SET
 * OF DESIRED STATES (one entry per participant × hole, overwritten in
 * place — never a log), and a flusher posts them sequentially per
 * participant. The server is last-writer-wins on (participant, hole); a
 * client that replays sends the card's `updated_at` it last saw and a
 * newer server value is a 409 the player resolves (keep mine / theirs).
 *
 *   network / 5xx  → keep (retry with backoff)
 *   4xx (not 409)  → drop + a hard error on the cell
 *   409            → conflict (the cell asks)
 *   2xx            → done
 */
export type OutboxState = 'pending' | 'conflict' | 'error';

export interface OutboxEntry {
  participantId: string;
  holeNumber: number;
  strokes: number;
  putts: number | null;
  fairwayHit: boolean | null;
  greenInRegulation: boolean | null;
  /** The card's updated_at the client last saw; null = no check. */
  expectedUpdatedAt: string | null;
  queuedAt: number;
  attempts: number;
  state: OutboxState;
  error?: string;
  /** On a conflict: the server's current stamp. */
  current?: string | null;
}

export interface Outbox {
  v: 1;
  groupPostId: string;
  savedAt: number;
  entries: OutboxEntry[];
}

export const OUTBOX_TTL_MS = 48 * 60 * 60 * 1000;

export function outboxKey(groupPostId: string): string {
  return `ea:golf-outbox:v1:${groupPostId}`;
}

export const entryKey = (participantId: string, holeNumber: number) => `${participantId}:${holeNumber}`;

/** One desired state per (participant, hole): a newer commit replaces the old one and restarts its attempts. */
export function upsertEntry(entries: OutboxEntry[], entry: Omit<OutboxEntry, 'queuedAt' | 'attempts' | 'state'> & Partial<Pick<OutboxEntry, 'queuedAt' | 'attempts' | 'state'>>, now: number = Date.now()): OutboxEntry[] {
  const key = entryKey(entry.participantId, entry.holeNumber);
  const next: OutboxEntry = { ...entry, queuedAt: entry.queuedAt ?? now, attempts: entry.attempts ?? 0, state: entry.state ?? 'pending', error: undefined, current: undefined };
  const rest = entries.filter(e => entryKey(e.participantId, e.holeNumber) !== key);
  return [...rest, next];
}

export function removeEntry(entries: OutboxEntry[], participantId: string, holeNumber: number): OutboxEntry[] {
  const key = entryKey(participantId, holeNumber);
  return entries.filter(e => entryKey(e.participantId, e.holeNumber) !== key);
}

export function markEntry(entries: OutboxEntry[], participantId: string, holeNumber: number, patch: Partial<OutboxEntry>): OutboxEntry[] {
  const key = entryKey(participantId, holeNumber);
  return entries.map(e => (entryKey(e.participantId, e.holeNumber) === key ? { ...e, ...patch } : e));
}

/** Parse + validate a stored outbox (garbage, another round, or expired → empty). */
export function parseOutbox(raw: string | null, groupPostId: string, now: number = Date.now()): OutboxEntry[] {
  if (!raw) return [];
  try {
    const o = JSON.parse(raw) as Outbox;
    if (!o || o.v !== 1 || o.groupPostId !== groupPostId || typeof o.savedAt !== 'number' || now - o.savedAt > OUTBOX_TTL_MS || !Array.isArray(o.entries)) return [];
    return o.entries.filter(e => e && typeof e.participantId === 'string' && Number.isInteger(e.holeNumber) && Number.isInteger(e.strokes) && e.strokes > 0);
  } catch {
    return [];
  }
}

export function serializeOutbox(groupPostId: string, entries: OutboxEntry[], now: number = Date.now()): string {
  const o: Outbox = { v: 1, groupPostId, savedAt: now, entries };
  return JSON.stringify(o);
}

export function readOutbox(groupPostId: string, now: number = Date.now()): OutboxEntry[] {
  try {
    return parseOutbox(window.localStorage.getItem(outboxKey(groupPostId)), groupPostId, now);
  } catch {
    return [];
  }
}

export function writeOutbox(groupPostId: string, entries: OutboxEntry[]): void {
  try {
    if (entries.length === 0) window.localStorage.removeItem(outboxKey(groupPostId));
    else window.localStorage.setItem(outboxKey(groupPostId), serializeOutbox(groupPostId, entries));
  } catch {
    /* private mode / quota: the keepalive flush is the other half */
  }
}

/** The server's hole scores with the outbox's desired states painted over them (a pending entry shows its value; a conflict shows the entry's value, flagged). */
export function overlayOutbox<T extends { hole_number: number; strokes: number | null; putts?: number | null; fairway_hit?: boolean | null; green_in_regulation?: boolean | null }>(
  holeScores: T[],
  entries: OutboxEntry[],
  participantId: string,
): Array<T | { hole_number: number; strokes: number; putts: number | null; fairway_hit: boolean | null; green_in_regulation: boolean | null }> {
  const mine = entries.filter(e => e.participantId === participantId);
  if (mine.length === 0) return holeScores;
  const byHole = new Map(mine.map(e => [e.holeNumber, e]));
  const out: Array<T | { hole_number: number; strokes: number; putts: number | null; fairway_hit: boolean | null; green_in_regulation: boolean | null }> = holeScores.map(h => {
    const e = byHole.get(h.hole_number);
    return e ? { ...h, strokes: e.strokes, putts: e.putts, fairway_hit: e.fairwayHit, green_in_regulation: e.greenInRegulation } : h;
  });
  const present = new Set(holeScores.map(h => h.hole_number));
  for (const e of mine) if (!present.has(e.holeNumber)) out.push({ hole_number: e.holeNumber, strokes: e.strokes, putts: e.putts, fairway_hit: e.fairwayHit, green_in_regulation: e.greenInRegulation });
  return out;
}

/** The cell's sync state: saved (no entry), pending, conflict, error. */
export function cellState(entries: OutboxEntry[], participantId: string, holeNumber: number): 'saved' | OutboxState {
  const e = entries.find(x => x.participantId === participantId && x.holeNumber === holeNumber);
  return e ? e.state : 'saved';
}

/** What a flush should do with a response. */
export function classifyResponse(status: number): 'done' | 'keep' | 'drop' | 'conflict' {
  if (status === 0) return 'keep'; // network
  if (status >= 200 && status < 300) return 'done';
  if (status === 409) return 'conflict';
  if (status >= 500 || status === 429) return 'keep';
  return 'drop';
}

/** Retry backoff: 2s, 4s, 8s … capped at 60s. */
export function backoffMs(attempts: number): number {
  return Math.min(60_000, 2_000 * 2 ** Math.max(0, attempts - 1));
}

/** The next pending entry to send, per participant in queue order (one at a time per participant keeps the server's last-writer-wins honest). */
export function nextToFlush(entries: OutboxEntry[], now: number = Date.now()): OutboxEntry | null {
  const pending = entries.filter(e => e.state === 'pending').sort((a, b) => a.queuedAt - b.queuedAt);
  for (const e of pending) {
    const due = e.attempts === 0 || now - e.queuedAt >= backoffMs(e.attempts);
    if (due) return e;
  }
  return null;
}
