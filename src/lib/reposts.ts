/**
 * Repost helpers — the pure logic behind posts.shared_post_id (migration 075).
 *
 * A repost is a normal posts row with shared_post_id pointing at the ORIGINAL
 * post and no media/stats/round of its own, so it classifies as a STATEMENT
 * (see src/lib/statements.ts — do not special-case reposts there).
 */

/**
 * Repost-of-a-repost collapses to the ROOT original (the X behavior): if the
 * post being reposted is itself a repost, target ITS original instead.
 * shared_post_id chains are therefore always exactly one level deep.
 */
export function resolveRepostTarget(original: {
  id: string;
  shared_post_id?: string | null;
}): string {
  return original.shared_post_id ?? original.id;
}

/**
 * Can `viewer` see the shared/original post? EXACT mirror of the messages
 * route's filterViewableSharedPost semantics
 * (src/app/api/messages/[conversationId]/route.ts:144-149):
 *   profileOk = owner profile not private OR viewer follows owner
 *   postOk    = post not private OR viewer follows owner
 *   viewable  = own post OR (profileOk AND postOk)
 * Note "not private" (not "=== 'public'") — treat unknown/null as open,
 * matching the messages behavior. Anonymous viewers pass isOwner=false,
 * isFollower=false.
 */
export function canViewSharedPost(args: {
  postVisibility: string | null | undefined;
  ownerVisibility: string | null | undefined;
  isOwner: boolean;
  isFollower: boolean;
}): boolean {
  if (args.isOwner) return true;
  const profileOk = args.ownerVisibility !== 'private' || args.isFollower;
  const postOk = args.postVisibility !== 'private' || args.isFollower;
  return profileOk && postOk;
}

/**
 * A repost must stay a statement (074's predicate): caption only, never
 * media/golf/stats. Returns an error message, or null when valid.
 */
export function validateRepostBody(body: {
  media?: unknown[] | null;
  golfData?: unknown | null;
  stats_data?: Record<string, unknown> | null;
}): string | null {
  if (Array.isArray(body.media) && body.media.length > 0) {
    return 'A repost cannot include media';
  }
  if (body.golfData) {
    return 'A repost cannot include golf data';
  }
  if (body.stats_data && Object.keys(body.stats_data).length > 0) {
    return 'A repost cannot include stats';
  }
  return null;
}
