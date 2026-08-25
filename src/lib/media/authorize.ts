import type { SupabaseClient } from '@supabase/supabase-js';
import { getProfileRole } from '@/lib/auth-server';
import { resolveProfileAction } from '@/lib/profile-roles';
import type { MediaTokenPayload } from './token';

/**
 * Server-side authorization for the media proxy. Given a verified token and
 * the live viewer, decide whether the bytes may be served and whether the
 * content is PUBLIC (drives Cache-Control).
 *
 * Visibility is re-evaluated LIVE from the governing entity, never trusted
 * from the token — a post flipping public→private is honored immediately.
 * Fails closed: a missing/deleted entity, or a media type not yet wired,
 * denies. Deliberately does NOT use canViewProfile (it rejects anonymous
 * viewers even of public profiles); mirrors the inline
 * owner || both-public || accepted-follower block used across the API.
 */

export interface MediaAuthResult {
  allow: boolean;
  /** True when anyone (incl. anonymous) may view — content is public. */
  isPublic: boolean;
}

const DENY: MediaAuthResult = { allow: false, isPublic: false };

async function isAcceptedFollower(
  admin: SupabaseClient,
  viewerId: string,
  ownerId: string
): Promise<boolean> {
  const { data } = await admin
    .from('follows')
    .select('id')
    .eq('follower_id', viewerId)
    .eq('following_id', ownerId)
    .eq('status', 'accepted')
    .maybeSingle();
  return !!data;
}

/** Guardian/owner of the target profile may view its content. */
async function hasManagedAccess(
  viewerId: string,
  ownerId: string
): Promise<boolean> {
  const role = await getProfileRole(viewerId, ownerId);
  return resolveProfileAction(role, 'approve_content');
}

/** Post media: owner || (post public AND owner public) || follower || guardian. */
async function authorizePost(
  admin: SupabaseClient,
  postId: string,
  viewerId: string | null
): Promise<MediaAuthResult> {
  const { data: post } = await admin
    .from('posts')
    .select('visibility, profile_id, profiles:profile_id ( visibility )')
    .eq('id', postId)
    .maybeSingle();
  if (!post || !post.profile_id) return DENY;

  const owner = (Array.isArray(post.profiles) ? post.profiles[0] : post.profiles) as
    | { visibility?: string }
    | null;
  const postPublic = post.visibility !== 'private';
  const ownerPublic = owner?.visibility !== 'private';

  if (postPublic && ownerPublic) return { allow: true, isPublic: true };

  if (!viewerId) return DENY;
  if (viewerId === post.profile_id) return { allow: true, isPublic: false };
  if (await isAcceptedFollower(admin, viewerId, post.profile_id as string)) {
    return { allow: true, isPublic: false };
  }
  if (await hasManagedAccess(viewerId, post.profile_id as string)) {
    return { allow: true, isPublic: false };
  }
  return DENY;
}

export async function authorizeMedia(
  admin: SupabaseClient,
  payload: MediaTokenPayload,
  viewerId: string | null
): Promise<MediaAuthResult> {
  switch (payload.t) {
    case 'cover':
      // Owner decision: covers stay public (identity image).
      return { allow: true, isPublic: true };
    case 'post':
      return authorizePost(admin, payload.id, viewerId);
    // message | group | equipment | vitals | workout — wired in later PRs;
    // fail closed until then (no such token is minted yet, so unreachable).
    default:
      return DENY;
  }
}
