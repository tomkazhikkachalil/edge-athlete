// ── Seeding a live workout's entries (Oct 18 2026) ──────────────────────────
// A live session's entries save is skipped as stale when its savedAt is not
// after the session's last_activity_at (entries-stale.ts, migration 256) —
// and a new session stamps that with the SERVER's clock. Seeding with this
// machine's Date.now() lost the race on production (a fast answer and a Mac
// ~0.1 s behind: the save came back { stale: true } and the workout opened
// empty). A seed stamps itself just after the session's own stamp instead.

/** A savedAt the server can never call stale for a session just started. */
export function savedAfter(session: { last_activity_at?: string | null }): number {
  const stamp = session.last_activity_at ? Date.parse(session.last_activity_at) : NaN;
  return Number.isFinite(stamp) ? Math.max(Date.now(), stamp + 1) : Date.now();
}
