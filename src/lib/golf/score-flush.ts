/**
 * Sending outbox entries (Events program, PR 14; per-hole CAS since phase
 * 2b, mig 209). One POST per entry on the score route: the hole's
 * `expected_version` rides along when the entry carries one (null =
 * unchecked), `penalties` only when the entry names them; a 409 carries
 * the hole's current row and the saved version comes back on a 201 so the
 * hook can keep its own writes' versions ahead of the card's refetch.
 * `keepaliveFlush` is the page-leaving half — the ScoreEntryModal's
 * pagehide pattern — one fire-and-forget request per participant with
 * every pending hole, the same guards.
 */
import { classifyResponse, type HoleCurrentRow, type OutboxEntry } from './score-outbox';

export type FlushOutcome =
  | { kind: 'done'; version: number | null }
  | { kind: 'keep'; error: string }
  | { kind: 'drop'; error: string }
  | { kind: 'conflict'; current: HoleCurrentRow | null };

/** The route's score shape for one entry (pure; tested). */
export function payloadFor(e: OutboxEntry): Record<string, unknown> {
  const p: Record<string, unknown> = { hole_number: e.holeNumber, strokes: e.strokes, putts: e.putts ?? undefined, fairway_hit: e.fairwayHit ?? undefined, green_in_regulation: e.greenInRegulation ?? undefined };
  if (e.penalties !== undefined) p.penalties = e.penalties;
  if (e.expectedVersion !== null && e.expectedVersion !== undefined) p.expected_version = e.expectedVersion;
  return p;
}

/** The saved version of `holeNumber` out of a 201 body (`golf_scores.hole_scores[].version`), or null. */
export function savedVersionFrom(body: unknown, holeNumber: number): number | null {
  const holes = (body as { golf_scores?: { hole_scores?: Array<{ hole_number?: unknown; version?: unknown }> } } | null)?.golf_scores?.hole_scores;
  if (!Array.isArray(holes)) return null;
  const h = holes.find(x => x && x.hole_number === holeNumber);
  return h && typeof h.version === 'number' ? h.version : null;
}

/** The hole's current row out of a 409 body (`conflicts[0].current`), or null. */
export function conflictCurrentFrom(body: unknown, holeNumber: number): HoleCurrentRow | null {
  const conflicts = (body as { conflicts?: Array<{ hole_number?: unknown; current?: HoleCurrentRow | null }> } | null)?.conflicts;
  if (!Array.isArray(conflicts)) return null;
  const c = conflicts.find(x => x && x.hole_number === holeNumber) ?? conflicts[0];
  return c?.current ?? null;
}

export async function flushEntry(e: OutboxEntry): Promise<FlushOutcome> {
  let status = 0;
  let body: unknown = {};
  try {
    const res = await fetch(`/api/golf/scorecards/${e.participantId}/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scores: [payloadFor(e)] }),
    });
    status = res.status;
    body = await res.json().catch(() => ({}));
  } catch {
    status = 0;
  }
  switch (classifyResponse(status)) {
    case 'done': return { kind: 'done', version: savedVersionFrom(body, e.holeNumber) };
    case 'conflict': return { kind: 'conflict', current: conflictCurrentFrom(body, e.holeNumber) };
    case 'drop': return { kind: 'drop', error: (body as { error?: string })?.error ?? `Could not save (${status}).` };
    default: return { kind: 'keep', error: status === 0 ? 'Offline — will retry.' : `Server busy (${status}) — will retry.` };
  }
}

/** On pagehide / hidden: everything pending, per participant, keepalive. Success is unconfirmed; the outbox keeps the entries until a real flush confirms. */
export function keepaliveFlush(entries: OutboxEntry[]): void {
  const byParticipant = new Map<string, OutboxEntry[]>();
  for (const e of entries) if (e.state === 'pending') byParticipant.set(e.participantId, [...(byParticipant.get(e.participantId) ?? []), e]);
  for (const [participantId, list] of byParticipant) {
    try {
      fetch(`/api/golf/scorecards/${participantId}/scores`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scores: list.map(payloadFor) }) }).catch(() => {});
    } catch { /* best-effort */ }
  }
}
