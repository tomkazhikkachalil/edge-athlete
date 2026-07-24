// ── "You have a live round" resolution ────────────────────────────────────────
// Pure logic behind GET /api/golf/live-round: given the user's participant
// rows (with embedded group post), pick the round the feed banner should
// resume — if any. Kept out of the route for unit testing.

import { isRoundLive } from './round-status';

export interface LiveRoundRow {
  /** group_post_participants.id — what score entry needs */
  participant_id: string;
  group_post: {
    id: string;
    status?: string | null;
    date?: string | null;
    post_id?: string | null;
    course_name?: string | null;
  };
}

/**
 * The round to offer resuming: LIVE per isRoundLive (status active, date
 * within the live window), most recent date wins on ties. Null when none.
 */
export function pickLiveRound(rows: LiveRoundRow[], now: number = Date.now()): LiveRoundRow | null {
  const live = rows.filter(r => r.group_post && isRoundLive(r.group_post, now));
  if (live.length === 0) return null;
  return live.reduce((best, r) =>
    Date.parse(r.group_post.date ?? '') > Date.parse(best.group_post.date ?? '') ? r : best
  );
}
