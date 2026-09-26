// ── Is this a RESULT? (results-kept round, 241) — pure, zero server imports ──
// Tom (Sep 26 2026): "any data metrics recorded will go towards understanding
// what the athlete's athletic score is." A result is never deleted by its
// player — it is HIDDEN from their profile and keeps counting. An ordinary
// post (a photo, a notion, a vitals entry) still deletes. Pinned in
// __tests__/results-hide.test.ts.

/** The post fields that say whether deleting it would lose recorded data. */
export interface PostResultFacts {
  group_post_id?: string | null;
  sport_event_round_id?: string | null;
  stats_data?: unknown;
}

function statsOf(p: PostResultFacts): Record<string, unknown> {
  return p.stats_data && typeof p.stats_data === 'object' ? (p.stats_data as Record<string, unknown>) : {};
}

/**
 * A result post: a round's feed card (its group post holds the scores), an
 * event's announce / results post, a mirrored event stat line, or a
 * self-entered stat line (its dataset row is keyed by the post). A post
 * that merely references a personal round (posts.round_id) is NOT — the
 * round survives the post (SET NULL); the round itself hides separately.
 */
export function isResultPost(p: PostResultFacts, hasPerformanceRow = false): boolean {
  if (p.group_post_id) return true;
  if (p.sport_event_round_id) return true;
  const sd = statsOf(p);
  if (sd.type === 'stat_line' || typeof sd.sport_event_stat_line_id === 'string') return true;
  return hasPerformanceRow;
}

/** Has ANYONE on a round recorded a score? (The creator counts — their own score is data too.) */
export function anyScoreRecorded(participants: ReadonlyArray<{ scores?: { holes_completed?: number | null; total_score?: number | null } | null }>): boolean {
  return participants.some(p => (p.scores?.holes_completed ?? 0) > 0 || p.scores?.total_score != null);
}

/** The words a successful "delete" of a result answers with. */
export const HIDDEN_NOTICE = 'Hidden from your profile. It still counts toward your stats — you can show it again under Settings → Privacy.';
