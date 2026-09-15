/**
 * Sending outbox entries (Events program, PR 14). One POST per entry on the
 * existing score route (`expected_updated_at` rides along unless the player
 * chose "keep mine"); `keepaliveFlush` is the page-leaving half — the
 * ScoreEntryModal's pagehide pattern — one fire-and-forget request per
 * participant with every pending hole.
 */
import { classifyResponse, type OutboxEntry } from './score-outbox';

export type FlushOutcome = { kind: 'done' } | { kind: 'keep'; error: string } | { kind: 'drop'; error: string } | { kind: 'conflict'; current: string | null };

function payload(e: OutboxEntry) {
  return { hole_number: e.holeNumber, strokes: e.strokes, putts: e.putts ?? undefined, fairway_hit: e.fairwayHit ?? undefined, green_in_regulation: e.greenInRegulation ?? undefined };
}

export async function flushEntry(e: OutboxEntry, opts: { force?: boolean } = {}): Promise<FlushOutcome> {
  let status = 0;
  let body: { error?: string; current?: string | null } = {};
  try {
    const res = await fetch(`/api/golf/scorecards/${e.participantId}/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scores: [payload(e)], ...(opts.force || !e.expectedUpdatedAt ? {} : { expected_updated_at: e.expectedUpdatedAt }) }),
    });
    status = res.status;
    body = (await res.json().catch(() => ({}))) as typeof body;
  } catch {
    status = 0;
  }
  switch (classifyResponse(status)) {
    case 'done': return { kind: 'done' };
    case 'conflict': return { kind: 'conflict', current: body.current ?? null };
    case 'drop': return { kind: 'drop', error: body.error ?? `Could not save (${status}).` };
    default: return { kind: 'keep', error: status === 0 ? 'Offline — will retry.' : `Server busy (${status}) — will retry.` };
  }
}

/** On pagehide / hidden: everything pending, per participant, keepalive. Success is unconfirmed; the outbox keeps the entries until a real flush confirms. */
export function keepaliveFlush(entries: OutboxEntry[]): void {
  const byParticipant = new Map<string, OutboxEntry[]>();
  for (const e of entries) if (e.state === 'pending') byParticipant.set(e.participantId, [...(byParticipant.get(e.participantId) ?? []), e]);
  for (const [participantId, list] of byParticipant) {
    try {
      fetch(`/api/golf/scorecards/${participantId}/scores`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scores: list.map(payload) }) }).catch(() => {});
    } catch { /* best-effort */ }
  }
}
