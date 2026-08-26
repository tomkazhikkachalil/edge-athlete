// ── Shared user_blocks filter ───────────────────────────────────────────────
// The ONE bidirectional block check (012_messaging's user_blocks table).
// Grown out of the messages fan-out precedent and mentions/notify.ts, which
// each inlined the same `.or()`; promoted to a shared helper in the Aug 2026
// hardening round when group-round adds gained a block gate.
//
// Semantics for consumers: SILENT SKIP (owner decision). A filtered id is
// quietly excluded — callers may surface a COUNT of skipped ids, never
// identities, so the blocker never learns they were targeted.
//
// ⚠️ ids are interpolated into a PostgREST `.or()` — every caller must have
// UUID-validated them first (isUuid, src/lib/uuid.ts). Routes do this at the
// handler top since the same round's 400-guard sweep.

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export interface BlockFilterResult {
  /** ids with no user_blocks row in either direction vs actorId, original order. */
  allowed: string[];
  /** How many unique candidate ids were dropped. */
  skipped: number;
}

/**
 * ids minus anyone with a user_blocks row in EITHER direction vs actorId.
 * Dedupes and drops the actor themselves. Fail-open on query error — a
 * blocked add slipping through a transient DB error matches the existing
 * notify.ts stance (best-effort gates never take the feature down).
 */
export async function filterBlockedBidirectional(
  admin: Admin,
  actorId: string,
  ids: string[]
): Promise<BlockFilterResult> {
  const unique = [...new Set(ids)].filter(id => id && id !== actorId);
  if (unique.length === 0) return { allowed: [], skipped: 0 };

  const { data, error } = await admin
    .from('user_blocks')
    .select('blocker_id, blocked_id')
    .or(
      `and(blocked_id.eq.${actorId},blocker_id.in.(${unique.join(',')})),and(blocker_id.eq.${actorId},blocked_id.in.(${unique.join(',')}))`
    );
  if (error) {
    console.error('[blocks] filter query failed (fail-open):', error);
    return { allowed: unique, skipped: 0 };
  }
  const blocked = new Set(
    (data || []).flatMap(b => [b.blocker_id, b.blocked_id]).filter(id => id !== actorId)
  );
  const allowed = unique.filter(id => !blocked.has(id));
  return { allowed, skipped: unique.length - allowed.length };
}
