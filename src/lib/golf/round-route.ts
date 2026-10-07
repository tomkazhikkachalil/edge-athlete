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
  /** The round's feed post — a DRAFT until posted (253). */
  post_id?: string | null;
}

/**
 * Where a DRAFT is reviewed and posted (Drafts round, 253): the review screen,
 * `/athlete/drafts/[postId]` — the composer, the live page and the card all
 * land there. ONE spelling, shared with the Drafts list.
 */
import { draftReviewHref } from '@/lib/drafts/list';
export { draftReviewHref as draftReviewPath };

/**
 * The path to send the user to after creating a round. A live round goes
 * straight to the scorer (`shouldEnterScorerAfterCreate`). An already-played
 * round is FINISHED at creation and its post is a DRAFT — the composer lands
 * on it so the person reviews and posts it (Finish and Post are two actions;
 * the round never surfaces on the feed by itself). Null = stay put (a
 * cancelled round, a non-golf group post, or no post id to land on).
 */
export function afterCreatePath(round: CreatedRoundLike | null | undefined): string | null {
  const scorer = shouldEnterScorerAfterCreate(round);
  if (scorer) return scorer;
  if (round?.type === 'golf_round' && round.status === 'completed' && round.post_id) {
    return draftReviewHref(round.post_id);
  }
  return null;
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
