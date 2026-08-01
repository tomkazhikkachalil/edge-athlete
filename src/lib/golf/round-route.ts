// ── Where a live round lives ──────────────────────────────────────────────────
// One definition of the live-round URL, and one decision about whether creating
// a round should take you there.
//
// This module exists because of a real bug. "Enter the round after Go Live" was
// previously implemented inside a parent's onPostCreated callback on ONE of the
// three pages that mount CreatePostModal — and the app header funnels most
// routes to a different one, so most users never entered the round at all. The
// decision has to live at the single point a round is created, keyed on data
// the create response always carries, not re-implemented per render site.
//
// Note it keys on group_post.id, NOT post_id: the feed post is created in the
// same transaction but its id reaches the client through a re-fetch that can
// silently fail, and a null there previously turned the whole feature off with
// no error.

/** The live-round screen. `/live` is the sport-agnostic live seam; this is its
 *  detail page, so a hockey period lands here later without a new route family. */
export function liveRoundPath(groupPostId: string): string {
  return `/live/${groupPostId}`;
}

export interface CreatedRoundLike {
  id?: string | null;
  type?: string | null;
  /** 'pending' | 'active' for a live round; 'completed' for already-played. */
  status?: string | null;
}

/**
 * The path to send the user to after creating a round, or null to stay put.
 *
 * Live rounds (pending/active) go straight to the scorer — that is the whole
 * point of pressing Go Live. An already-played round is a post, not a round to
 * play, so it stays on whichever page composed it.
 */
export function shouldEnterScorerAfterCreate(round: CreatedRoundLike | null | undefined): string | null {
  if (!round?.id) return null;
  if (round.type !== 'golf_round') return null;
  if (round.status === 'completed' || round.status === 'cancelled') return null;
  return liveRoundPath(round.id);
}
