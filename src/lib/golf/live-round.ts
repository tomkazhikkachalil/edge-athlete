// ── "You have a round in progress" resolution ────────────────────────────────
// Pure logic behind GET /api/golf/live-round: given the user's participant
// rows (with embedded group post), pick the round to offer resuming — if
// any. Status-only since the Drafts round (Oct 2026): a round is in progress
// while it is pending or active, however long ago it was played — there is
// no quiet rule and no date window here (the LIVE strip keeps its ±48 h
// "played now" window; this is the way back in, and the reopen prompt's
// source). Kept out of the route for unit testing.

export interface LiveRoundRow {
  /** group_post_participants.id — what score entry needs */
  participant_id: string;
  /** The user's own holes_completed (null/undefined when they have no scores row yet) */
  holes_completed?: number | null;
  group_post: {
    id: string;
    status?: string | null;
    date?: string | null;
    post_id?: string | null;
    course_name?: string | null;
    /** Round length from golf_scorecard_data — needed to tell "done" from "mid-round" */
    holes_played?: number | null;
    /** Round-wide newest score write — the 6h auto-end rule hides the banner
     *  for quiet rounds (isRoundLive reads it) */
    last_score_activity_at?: string | null;
  };
}

/** The user finished their own card — nothing left to resume, even while
 *  co-players keep the ROUND live (round status tracks the slowest player). */
function cardComplete(r: LiveRoundRow): boolean {
  const total = r.group_post.holes_played;
  const done = r.holes_completed;
  return typeof total === 'number' && total > 0 && typeof done === 'number' && done >= total;
}

/**
 * The round to offer resuming: IN PROGRESS (status pending OR active — a
 * freshly started zero-score round must get its offer too), the user's own
 * card not yet complete, the most recent date wins on ties. Null when none.
 * `now` is accepted for the callers' sake; nothing here is clock-based.
 */
export function pickLiveRound(rows: LiveRoundRow[], now: number = Date.now()): LiveRoundRow | null {
  void now;
  const live = rows.filter(r => r.group_post && (r.group_post.status === 'pending' || r.group_post.status === 'active') && !cardComplete(r));
  if (live.length === 0) return null;
  return live.reduce((best, r) =>
    Date.parse(r.group_post.date ?? '') > Date.parse(best.group_post.date ?? '') ? r : best
  );
}
