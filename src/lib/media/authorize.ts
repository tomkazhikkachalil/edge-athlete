import type { SupabaseClient } from '@supabase/supabase-js';
import { getProfileRole } from '@/lib/auth-server';
import { resolveProfileAction } from '@/lib/profile-roles';
import { fetchVitalsPrivacy } from '@/lib/vitals-privacy-server';
import { aspectHidden } from '@/lib/vitals-privacy';
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

/** Household access to the target profile's content: a guardian (via the
 *  matrix) — or, since Wave 9, a view-only seat (role 'viewer', mig 138).
 *  Viewers exist precisely to follow the child's content, and the archive
 *  reads through this proxy; a stranger has no profile_access row and never
 *  reaches either branch. */
async function hasManagedAccess(
  viewerId: string,
  ownerId: string
): Promise<boolean> {
  const role = await getProfileRole(viewerId, ownerId);
  return role === 'viewer' || resolveProfileAction(role, 'approve_content');
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

/**
 * Message media: strictly conversation-participant scoped — never public.
 * Matches the read gate on GET /api/messages/[id] (participant membership,
 * no block filter on reads: a participant sees the conversation's media).
 */
async function authorizeMessage(
  admin: SupabaseClient,
  messageId: string,
  viewerId: string | null
): Promise<MediaAuthResult> {
  if (!viewerId) return DENY; // messages are never anon-viewable
  const { data: message } = await admin
    .from('messages')
    .select('conversation_id, deleted_at')
    .eq('id', messageId)
    .maybeSingle();
  if (!message || message.deleted_at || !message.conversation_id) return DENY;

  const { data: participant } = await admin
    .from('conversation_participants')
    .select('id')
    .eq('conversation_id', message.conversation_id)
    .eq('profile_id', viewerId)
    .is('left_at', null)
    .maybeSingle();
  return participant ? { allow: true, isPublic: false } : DENY;
}

/**
 * Group/round media: public group post OR creator OR any participant (any
 * attestation status) — an exact mirror of the SQL `can_view_group_post`
 * (migration 063). Anonymous may view only a public group post.
 */
async function authorizeGroup(
  admin: SupabaseClient,
  groupPostId: string,
  viewerId: string | null
): Promise<MediaAuthResult> {
  const { data: gp } = await admin
    .from('group_posts')
    .select('visibility, creator_id')
    .eq('id', groupPostId)
    .maybeSingle();
  if (!gp) return DENY;
  if (gp.visibility === 'public') return { allow: true, isPublic: true };
  if (!viewerId) return DENY;
  if (viewerId === gp.creator_id) return { allow: true, isPublic: false };
  const { data: participant } = await admin
    .from('group_post_participants')
    .select('id')
    .eq('group_post_id', groupPostId)
    .eq('profile_id', viewerId)
    .maybeSingle();
  return participant ? { allow: true, isPublic: false } : DENY;
}

/**
 * Profile-scoped media (equipment images, workout-set media): governed by the
 * owner profile's visibility — owner || public || accepted-follower || guardian.
 * Anonymous may view a public profile's media. The token id is the owner
 * profile id.
 */
async function profileScoped(
  admin: SupabaseClient,
  ownerId: string,
  viewerId: string | null
): Promise<MediaAuthResult> {
  const { data: prof } = await admin
    .from('profiles')
    .select('visibility')
    .eq('id', ownerId)
    .maybeSingle();
  if (!prof) return DENY;
  if (prof.visibility !== 'private') return { allow: true, isPublic: true };
  if (!viewerId) return DENY;
  if (viewerId === ownerId) return { allow: true, isPublic: false };
  if (await isAcceptedFollower(admin, viewerId, ownerId)) return { allow: true, isPublic: false };
  if (await hasManagedAccess(viewerId, ownerId)) return { allow: true, isPublic: false };
  return DENY;
}

/**
 * Workout-set media: profile-scoped, additionally hidden when the owner set
 * the vitals `workouts` (or master) privacy aspect (migration 122) — matching
 * GET /api/workouts, which returns an empty list in that case.
 */
async function authorizeWorkout(
  admin: SupabaseClient,
  ownerId: string,
  viewerId: string | null
): Promise<MediaAuthResult> {
  const base = await profileScoped(admin, ownerId, viewerId);
  if (!base.allow) return DENY;
  if (viewerId !== ownerId) {
    const privacy = await fetchVitalsPrivacy(admin, ownerId);
    if (aspectHidden(privacy, 'workouts', false)) return DENY;
  }
  return base;
}

/**
 * Contest media (phase 4): org staff of the competition owner, staff of a
 * participating club, an actively tagged athlete (or their household), or
 * an active roster member of a participating team. NEVER public through
 * this proxy — the R5 public gallery serves consent-gated bytes through
 * its own streamer with its own gate. Token id = the contest_media row.
 */
async function authorizeContestMedia(
  admin: SupabaseClient,
  mediaId: string,
  viewerId: string | null
): Promise<MediaAuthResult> {
  if (!viewerId) return DENY;
  const { data: media } = await admin
    .from('contest_media')
    .select('contest_id, contest:contest_id (competition:competition_id (league_id, club_id))')
    .eq('id', mediaId)
    .maybeSingle();
  if (!media) return DENY;
  const contest = Array.isArray(media.contest) ? media.contest[0] : media.contest;
  const compRaw = contest?.competition;
  const comp = (Array.isArray(compRaw) ? compRaw[0] : compRaw) as
    | { league_id: string | null; club_id: string | null }
    | null
    | undefined;
  if (!comp) return DENY;

  // Actively tagged, or household access to a tagged profile.
  const { data: tags } = await admin
    .from('contest_media_tags')
    .select('profile_id')
    .eq('media_id', mediaId)
    .eq('status', 'active')
    .limit(100);
  const taggedIds = (tags ?? []).map(t => t.profile_id as string);
  if (taggedIds.includes(viewerId)) return { allow: true, isPublic: false };
  for (const taggedId of taggedIds) {
    if (await hasManagedAccess(viewerId, taggedId)) return { allow: true, isPublic: false };
  }

  // Manager of an org touching the contest: the owner, or the owning club
  // of a participating team.
  const { data: participants } = await admin
    .from('contest_participants')
    .select('entry:entry_id (team_id)')
    .eq('contest_id', media.contest_id as string);
  const teamIds: string[] = [];
  for (const p of participants ?? []) {
    const entry = Array.isArray(p.entry) ? p.entry[0] : p.entry;
    if (entry?.team_id) teamIds.push(entry.team_id as string);
  }
  const { data: teamRows } = teamIds.length
    ? await admin.from('teams').select('id, club_id').in('id', teamIds)
    : { data: [] };
  const clubIds = new Set(
    (teamRows ?? []).map(t => t.club_id as string | null).filter((v): v is string => !!v)
  );
  if (comp.club_id) clubIds.add(comp.club_id);

  const managerChecks: PromiseLike<boolean>[] = [];
  if (comp.league_id) {
    managerChecks.push(
      admin
        .from('memberships')
        .select('id')
        .eq('league_id', comp.league_id)
        .eq('profile_id', viewerId)
        .eq('scope_type', 'org')
        .eq('status', 'active')
        .in('role', ['owner', 'manager'])
        .limit(1)
        .maybeSingle()
        .then(({ data }: { data: unknown }) => !!data)
    );
  }
  for (const clubId of clubIds) {
    managerChecks.push(
      admin
        .from('memberships')
        .select('id')
        .eq('club_id', clubId)
        .eq('profile_id', viewerId)
        .eq('scope_type', 'org')
        .eq('status', 'active')
        .in('role', ['owner', 'manager'])
        .limit(1)
        .maybeSingle()
        .then(({ data }: { data: unknown }) => !!data)
    );
  }
  if ((await Promise.all(managerChecks)).some(Boolean)) {
    return { allow: true, isPublic: false };
  }

  // Active roster member of a participating team (teammates see the album).
  if (teamIds.length) {
    const { data: rosterRow } = await admin
      .from('memberships')
      .select('id')
      .eq('profile_id', viewerId)
      .eq('kind', 'roster')
      .eq('status', 'active')
      .eq('scope_type', 'team')
      .in('scope_id', teamIds)
      .limit(1)
      .maybeSingle();
    if (rosterRow) return { allow: true, isPublic: false };
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
    case 'vitals':
      // Vitals-linked media is post media (linked_post_id → post_media); the
      // token id is that post's id, governed by the post rule.
      return authorizePost(admin, payload.id, viewerId);
    case 'message':
      return authorizeMessage(admin, payload.id, viewerId);
    case 'group':
      return authorizeGroup(admin, payload.id, viewerId);
    case 'equipment':
      return profileScoped(admin, payload.id, viewerId);
    case 'workout':
      return authorizeWorkout(admin, payload.id, viewerId);
    case 'contest_media':
      return authorizeContestMedia(admin, payload.id, viewerId);
    default:
      return DENY;
  }
}
