// ── One activity, however many times it arrives (mig 247) — pure ────────────
// A run recorded on a watch can reach us more than once: the provider's
// delivery, the phone's bridge app, and the athlete's own file export of the
// same thing. Two rules keep it ONE activity:
//
//   1. The SAME source delivering the SAME id (a re-import of a file, a
//      provider's retry) refreshes the row — the 245 rule, unchanged.
//   2. ANY source delivering an activity that STARTS within a minute of one
//      the athlete already has, with a duration within 10%, is that activity.
//      The row keeps the identity of whoever delivered it first; its data is
//      replaced only when the newcomer is RICHER (it has the route the first
//      lacked, or the heart rate) — a thin copy never overwrites a full one.
//
// An athlete cannot be on two runs at once, so the start is the identity; the
// duration term keeps a watch's "Run" from swallowing the 5-minute warm-up it
// was started beside. Clocks disagree by seconds (a file's first trackpoint
// vs the device's own start), never by minutes.

export const DEDUPE_START_WINDOW_S = 60;
export const DEDUPE_DURATION_TOLERANCE = 0.1;

export interface ActivityIdentity {
  /** epoch milliseconds */
  startedAt: number;
  elapsedS: number;
}

export function isSameActivity(a: ActivityIdentity, b: ActivityIdentity): boolean {
  if (Math.abs(a.startedAt - b.startedAt) > DEDUPE_START_WINDOW_S * 1000) return false;
  const longer = Math.max(a.elapsedS, b.elapsedS);
  if (longer <= 0) return true;
  return Math.abs(a.elapsedS - b.elapsedS) <= longer * DEDUPE_DURATION_TOLERANCE;
}

/** Among the athlete's activities near the incoming start, the one it
 *  duplicates — the closest start wins when several qualify. */
export function findDuplicate<T extends ActivityIdentity>(candidates: readonly T[], incoming: ActivityIdentity): T | null {
  let best: T | null = null;
  for (const c of candidates) {
    if (!isSameActivity(c, incoming)) continue;
    if (!best || Math.abs(c.startedAt - incoming.startedAt) < Math.abs(best.startedAt - incoming.startedAt)) best = c;
  }
  return best;
}

export interface ActivityRichness {
  hasRoute: boolean;
  hasHeartRate: boolean;
}

/** Whether a second delivery of the same activity should replace the stored
 *  data. Equal richness keeps what is there (no churn on every re-delivery). */
export function incomingIsRicher(existing: ActivityRichness, incoming: ActivityRichness): boolean {
  if (incoming.hasRoute !== existing.hasRoute) return incoming.hasRoute;
  if (incoming.hasHeartRate !== existing.hasHeartRate) return incoming.hasHeartRate;
  return false;
}
