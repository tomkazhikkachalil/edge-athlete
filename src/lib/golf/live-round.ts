// ── "You have a live round" resolution ────────────────────────────────────────
// Pure logic behind GET /api/golf/live-round: given the user's participant
// rows (with embedded group post), pick the round the feed banner should
// resume — if any. Kept out of the route for unit testing.

import { isRoundLive } from './round-status';

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
 * The round to offer resuming: LIVE per isRoundLive (status active, date
 * within the live window), the user's own card not yet complete, most recent
 * date wins on ties. Null when none.
 */
export function pickLiveRound(rows: LiveRoundRow[], now: number = Date.now()): LiveRoundRow | null {
  const live = rows.filter(r => r.group_post && isRoundLive(r.group_post, now) && !cardComplete(r));
  if (live.length === 0) return null;
  return live.reduce((best, r) =>
    Date.parse(r.group_post.date ?? '') > Date.parse(best.group_post.date ?? '') ? r : best
  );
}
