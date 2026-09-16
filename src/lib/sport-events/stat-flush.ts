/**
 * Sending stat outbox entries (Events program, phase 4): one PUT per entry
 * on the line route (`statLinePath`), the whole stats object + the version
 * last seen; a 201 / 200 carries the saved line (`line.version`), a 409
 * carries the line as the server holds it (`current`). `keepaliveStatFlush`
 * is the page-leaving half.
 */
import { classifyResponse, type StatCurrentRow, type StatOutboxEntry } from './stat-outbox';

export type StatFlushOutcome =
  | { kind: 'done'; version: number | null }
  | { kind: 'keep'; error: string }
  | { kind: 'drop'; error: string }
  | { kind: 'conflict'; current: StatCurrentRow | null };

export const statsPath = (eventId: string, roundId: string) => `/api/sport-events/${eventId}/rounds/${roundId}/stats`;
export const statLinePath = (eventId: string, roundId: string, lineId: string) => `${statsPath(eventId, roundId)}/${lineId}`;
export const scorePath = (eventId: string, roundId: string) => `/api/sport-events/${eventId}/rounds/${roundId}/score`;

/** The route's body for one entry (pure; tested). */
export function statPayloadFor(e: StatOutboxEntry): { stats: Record<string, number>; expected_version: number } {
  return { stats: e.stats, expected_version: e.expectedVersion };
}

/** The saved version out of a success body (`line.version`), or null. */
export function savedStatVersionFrom(body: unknown): number | null {
  const v = (body as { line?: { version?: unknown } } | null)?.line?.version;
  return typeof v === 'number' ? v : null;
}

/** The line as the server holds it out of a 409 body (`current`), or null. */
export function conflictStatFrom(body: unknown): StatCurrentRow | null {
  const c = (body as { current?: { version?: unknown; stats?: unknown } | null } | null)?.current;
  if (!c || typeof c.version !== 'number' || !c.stats || typeof c.stats !== 'object') return null;
  return { version: c.version, stats: c.stats as Record<string, number> };
}

export async function flushStatEntry(e: StatOutboxEntry, eventId: string, roundId: string): Promise<StatFlushOutcome> {
  let status = 0;
  let body: unknown = {};
  try {
    const res = await fetch(statLinePath(eventId, roundId, e.lineId), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(statPayloadFor(e)) });
    status = res.status;
    body = await res.json().catch(() => ({}));
  } catch {
    status = 0;
  }
  switch (classifyResponse(status)) {
    case 'done': return { kind: 'done', version: savedStatVersionFrom(body) };
    case 'conflict': return { kind: 'conflict', current: conflictStatFrom(body) };
    case 'drop': return { kind: 'drop', error: (body as { error?: string })?.error ?? `Could not save (${status}).` };
    default: return { kind: 'keep', error: status === 0 ? 'Offline — will retry.' : `Server busy (${status}) — will retry.` };
  }
}

/** On pagehide / hidden: every pending line, keepalive. Unconfirmed; the outbox keeps the entries until a real flush confirms. */
export function keepaliveStatFlush(entries: StatOutboxEntry[], eventId: string, roundId: string): void {
  for (const e of entries) {
    if (e.state !== 'pending') continue;
    try {
      fetch(statLinePath(eventId, roundId, e.lineId), { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(statPayloadFor(e)) }).catch(() => {});
    } catch { /* best-effort */ }
  }
}
