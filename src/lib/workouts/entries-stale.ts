/**
 * The entries PUT's stale-write rule (workout capture round PR 2, Oct 9 2026).
 * Zero imports.
 *
 * The guard exists for a LIVE session: the editor's debounced PUT and its
 * keepalive flush can land out of order, and an older snapshot must never
 * overwrite a newer one — so a snapshot whose `savedAt` is not after the
 * session's `last_activity_at` is a no-op (the route answers `{ stale: true }`).
 *
 * A COMPLETED session is different: its `last_activity_at` is the workout's
 * END time (the finish PATCH writes `ended_at`; a manual log writes
 * `startedAt + duration`), not the last entries write — and a manual workout
 * logged for today can END in the future. Review-mode edits (the share
 * step's Edit / Remove, a set edited after the fact) are user-sequential, so
 * the guard has nothing to protect there and, before this rule, silently
 * dropped every such edit until the clock passed the workout's end
 * (`workout-review.spec` caught it). For a completed session the guard is
 * off and the end time is left alone.
 */

export interface StaleWriteInput {
  status: string;
  /** The session's `last_activity_at`, ISO or null. */
  lastActivityAt: string | null;
  /** The snapshot's `savedAt`, epoch ms (the client's clock). */
  savedAt: number;
}

/** True when the snapshot must be dropped as out of order. */
export function entriesWriteIsStale({ status, lastActivityAt, savedAt }: StaleWriteInput): boolean {
  if (status === 'completed') return false;
  if (!lastActivityAt) return false;
  const last = Date.parse(lastActivityAt);
  return Number.isFinite(last) && savedAt <= last;
}

/** Whether this write should move `last_activity_at` to its `savedAt`. */
export function entriesWriteStampsActivity(status: string): boolean {
  return status !== 'completed';
}
