import { NextRequest, NextResponse } from 'next/server';
import { getEnabledSports } from '@/lib/sports/SportRegistry';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { GROUP_SCORECARD_SELECT, transformGroupPostToScorecard } from '@/lib/golf/scorecard-transform';
import { isActiveParticipant, isRoundLive } from '@/lib/golf/round-status';
import { canPin, MAX_PINNED_POSTS } from '@/lib/posts/pinning';
import { deletePostCascade } from '@/lib/posts/delete-post-server';
import { deleteRoundCascade } from '@/lib/golf/round-delete-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { resolveRepostTarget, canViewSharedPost, validateRepostBody } from '@/lib/reposts';
import { normalizePostIdentity } from '@/lib/posts/post-category';
import { createGolfRoundEntities } from '@/lib/golf/post-write';
import { fetchGolfRoundById, fetchGolfRoundsByIds } from '@/lib/golf/post-read';
import { enforceRateLimit } from '@/lib/rate-limit';
import { isOrgLensVisible } from '@/lib/affiliations/org-peers';

// Interface for tagged profiles
interface TaggedProfile {
  id: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  handle: string | null;
}

// Reject non-UUID ids up front (garbage used to hit PostgREST as 22P02 → 500)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Select shape for a repost's quoted ORIGINAL — the wire subset
 *  QuotedPostEmbed renders, plus visibility/status/profile visibility for
 *  the per-viewer gate (stripped before shipping). */
const SHARED_POST_SELECT = `
  id,
  caption,
  visibility,
  status,
  created_at,
  profile_id,
  profile:profile_id (
    id, first_name, last_name, full_name, avatar_url, handle, visibility
  ),
  media:post_media ( media_url, media_type )
`;

/** Gate + shape a fetched original for a given viewer. Returns the wire
 *  QuotedPost or null ("post unavailable" to this viewer). Mirrors the
 *  messages route's filterViewableSharedPost semantics via canViewSharedPost. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function gateSharedPost(orig: any, currentUserId: string | null, followingIds: Set<string>) {
  if (!orig) return null;
  const owner = Array.isArray(orig.profile) ? orig.profile[0] : orig.profile;
  if (!owner?.id) return null;
  // Approval queue: unpublished originals stay hidden from everyone but
  // their author (flag-gated — posts.status needs migration 051).
  if (
    FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES &&
    orig.status && orig.status !== 'published' &&
    orig.profile_id !== currentUserId
  ) {
    return null;
  }
  const visible = canViewSharedPost({
    postVisibility: orig.visibility,
    ownerVisibility: owner.visibility,
    isOwner: currentUserId === owner.id,
    isFollower: followingIds.has(owner.id),
  });
  if (!visible) return null;
  return {
    id: orig.id,
    caption: orig.caption,
    created_at: orig.created_at,
    profile: {
      id: owner.id,
      first_name: owner.first_name,
      last_name: owner.last_name,
      full_name: owner.full_name,
      avatar_url: owner.avatar_url,
      handle: owner.handle,
    },
    media: (orig.media || []).map((m: { media_url: string; media_type: string }) => ({
      media_url: m.media_url,
      media_type: m.media_type,
    })),
  };
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    // Require authentication
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'post-create', { userId: user.id });
    if (limited) return limited;


    const body = await request.json();
    const {
      postType: rawPostType = 'general', // 'general' or a registry sport_key
      caption = '',
      hashtags = [],
      visibility = 'public',
      media = [],
      golfData = null,
      taggedProfiles = [], // Array of profile IDs to tag in this post
      stats_data: incomingStatsData = null, // Optional structured metadata (e.g. vitals_entry)
      sharedPostId = null, // Repost: the post being shared (075)
      postCategory: rawPostCategory = null, // Cross-cutting category (077): 'training'
    } = body;

    // Category normalization — also maps the pre-077 legacy shape
    // (postType 'training') onto {general + training}.
    const identity = normalizePostIdentity(rawPostType, rawPostCategory);
    if ('error' in identity) {
      return NextResponse.json({ error: identity.error }, { status: 400 });
    }
    const { postType, postCategory } = identity;

    // Content owner: the session user, or — guardian-profiles — a managed
    // athlete via targetProfileId. The shared gate (guardian-gate.ts) is
    // server-authoritative: guardian row re-checked, publishing to a
    // supervised profile requires APPROVED parental consent.
    const targetProfileId =
      typeof body.targetProfileId === 'string' ? body.targetProfileId : null;
    const { resolveActingProfile } = await import('@/lib/guardian-gate');
    const gate = await resolveActingProfile(
      user.id, targetProfileId, 'You do not have permission to post to this profile'
    );
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }
    const userId = gate.actorId;
    if (!gate.actingAs && FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      // Supervised minors posting to their OWN profile: content queues for
      // guardian approval — they can write, never publish (resolver matrix).
      const { getProfileRole } = await import('@/lib/auth-server');
      const selfRole = await getProfileRole(user.id, user.id);
      if (selfRole === 'supervised') {
        body.__forcePendingApproval = true;
      }
    }

    // Validate post type: 'general' plus any registry-enabled sport.
    // Enabling a sport in SportRegistry automatically allows its posts here.
    const validPostTypes = ['general', ...getEnabledSports().map(s => s.sport_key)];
    if (!validPostTypes.includes(postType)) {
      return NextResponse.json({ error: 'Invalid post type' }, { status: 400 });
    }

    // Validate visibility
    if (!['public', 'private'].includes(visibility)) {
      return NextResponse.json({ error: 'Invalid visibility setting' }, { status: 400 });
    }

    // Repost validation. A repost is caption-only — media/golf/stats would
    // break the 074 STATEMENT classification — and must target a post the
    // REPOSTER can see. Repost-of-a-repost collapses to the ROOT original,
    // and the gate runs against that root (it's what viewers will see).
    let repostTargetId: string | null = null;
    if (sharedPostId) {
      if (typeof sharedPostId !== 'string' || !UUID_RE.test(sharedPostId)) {
        return NextResponse.json({ error: 'Post not found' }, { status: 404 });
      }
      const repostError = validateRepostBody({ media, golfData, stats_data: incomingStatsData });
      if (repostError) {
        return NextResponse.json({ error: repostError }, { status: 400 });
      }
      if (postType !== 'general') {
        return NextResponse.json({ error: 'A repost must be a general post' }, { status: 400 });
      }

      const fetchOriginal = async (id: string) => {
        const { data } = await supabase
          .from('posts')
          .select('id, profile_id, visibility, status, shared_post_id, profiles:profile_id (visibility)')
          .eq('id', id)
          .maybeSingle();
        return data;
      };
      let original = await fetchOriginal(sharedPostId);
      if (original?.shared_post_id) {
        // Root-collapse, then re-gate against the root.
        original = await fetchOriginal(resolveRepostTarget(original));
      }
      // 404 (not 403) throughout — don't confirm a hidden post's existence.
      if (!original) {
        return NextResponse.json({ error: 'Post not found' }, { status: 404 });
      }
      if (
        FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES &&
        original.status && original.status !== 'published' &&
        original.profile_id !== userId
      ) {
        return NextResponse.json({ error: 'Post not found' }, { status: 404 });
      }
      const ownerProfile = Array.isArray(original.profiles) ? original.profiles[0] : original.profiles;
      let isFollower = false;
      if (original.profile_id !== userId) {
        const { data: follow } = await supabase
          .from('follows')
          .select('id')
          .eq('follower_id', userId)
          .eq('following_id', original.profile_id)
          .eq('status', 'accepted')
          .maybeSingle();
        isFollower = !!follow;
      }
      const canRepost = canViewSharedPost({
        postVisibility: original.visibility,
        ownerVisibility: ownerProfile?.visibility,
        isOwner: original.profile_id === userId,
        isFollower,
      });
      if (!canRepost) {
        return NextResponse.json({ error: 'Post not found' }, { status: 404 });
      }
      repostTargetId = original.id;
    }

    // Create the post record
    const postData: {
      profile_id: string;
      sport_key: string;
      caption: string;
      visibility: string;
      tags: string[];
      hashtags: string[];
      likes_count: number;
      comments_count: number;
      round_id?: string;
      stats_data?: Record<string, unknown>;
      activity_mode?: string;
      shared_post_id?: string;
      post_category?: string;
      created_by_user_id?: string;
    } = {
      profile_id: userId,
      sport_key: postType, // Use postType as sport_key for our unified approach
      caption: caption,
      visibility: visibility,
      // Supervised authors queue for guardian approval (guardian-profiles).
      ...(body.__forcePendingApproval ? { status: 'pending_approval' } : {}),
      // Attribution (090): when a guardian posts on behalf of a managed
      // athlete, record the HUMAN author. NULL for normal self-posts.
      ...(userId !== user.id ? { created_by_user_id: user.id } : {}),
      tags: taggedProfiles, // Store tagged people IDs (not category tags)
      hashtags: hashtags,
      likes_count: 0,
      comments_count: 0,
      ...(incomingStatsData && postType !== 'golf' ? { stats_data: incomingStatsData } : {}),
      ...(repostTargetId ? { shared_post_id: repostTargetId } : {}),
      ...(postCategory ? { post_category: postCategory } : {}),
    };

    let roundId: string | null = null;

    // Sport write dispatch — golf is the only deep-table sport today; its
    // round/holes creation lives in src/lib/golf/post-write.ts (moved intact,
    // migration-020/023 history documented there).
    //
    // LEGACY CREATE PATH (Aug 2026 flow unification): the composer no longer
    // sends golfData — every new golf round rides POST /api/group-posts.
    // This branch stays for stale clients mid-deploy and because legacy
    // golf_rounds posts still render through it; do not extend it.
    if (postType === 'golf' && golfData) {
      const golfResult = await createGolfRoundEntities(supabase, userId, golfData);
      if (!golfResult.ok) {
        return NextResponse.json({ error: golfResult.message }, { status: 500 });
      }
      roundId = golfResult.roundId;

      // Add golf references to post.
      // activity_mode is the sport-agnostic column (migration 020).
      if (roundId) {
        postData.round_id = roundId;
        postData.activity_mode = 'round_recap';
      }
    }

    let { data: post, error: postError } = await supabase
      .from('posts')
      .insert(postData)
      .select()
      .single();

    // Defensive: migration 020 adds posts.activity_mode. If it hasn't been
    // applied yet, Postgres/PostgREST rejects the column (42703 / PGRST204).
    // Retry once without it so post creation never breaks on migration lag.
    if (
      postError &&
      postData.activity_mode !== undefined &&
      (postError.code === '42703' || postError.code === 'PGRST204') &&
      (postError.message || '').includes('activity_mode')
    ) {
      console.warn('[POST] activity_mode column missing (migration 020 not applied) — retrying insert without it');
      delete postData.activity_mode;
      ({ data: post, error: postError } = await supabase
        .from('posts')
        .insert(postData)
        .select()
        .single());
    }

    // Same migration-lag guard for attribution (migration 090).
    if (
      postError &&
      postData.created_by_user_id !== undefined &&
      (postError.code === '42703' || postError.code === 'PGRST204') &&
      (postError.message || '').includes('created_by_user_id')
    ) {
      console.warn('[POST] created_by_user_id column missing (migration 090 not applied) — retrying insert without it');
      delete postData.created_by_user_id;
      ({ data: post, error: postError } = await supabase
        .from('posts')
        .insert(postData)
        .select()
        .single());
    }

    if (postError) {
      console.error('[POST] Post creation error:', postError);
      console.error('[POST] Error details:', {
        message: postError.message,
        details: postError.details,
        hint: postError.hint,
        code: postError.code
      });
      return NextResponse.json({
        error: 'Failed to create post',
        details: postError.message,
        code: postError.code,
        hint: postError.hint
      }, { status: 500 });
    }

    // Guardian-profiles: a supervised author's post just entered the approval
    // queue — push it to their guardians' bells (best-effort, never fails the
    // post).
    if (body.__forcePendingApproval && post?.id) {
      const { notifyGuardians, profileFirstName } = await import('@/lib/guardian-notify');
      const childName = await profileFirstName(supabase, userId);
      await notifyGuardians(supabase, userId, {
        type: 'post_pending_approval',
        title: `${childName} shared a post that needs your review`,
        actionUrl: '/app/guardian/approvals',
        actorId: userId,
        metadata: { post_id: post.id },
      });
    }

    // Add media files if provided
    if (media && media.length > 0) {
      const mediaRecords = media.map((file: { url: string; type: string; sortOrder?: number; thumbnailUrl?: string }, index: number) => ({
        post_id: post.id,
        media_url: file.url,
        media_type: file.type,
        display_order: (file.sortOrder ?? index) + 1, // ?? — sortOrder 0 is valid (|| collapsed slots 0 and 1)
        thumbnail_url: file.thumbnailUrl || null
      }));

      const { error: mediaError } = await supabase
        .from('post_media')
        .insert(mediaRecords);

      if (mediaError) {
        console.error('Media creation error:', mediaError);
        // Don't fail the entire request, but log the error
      }
    }

    // Create tags if taggedProfiles provided
    if (taggedProfiles && taggedProfiles.length > 0) {
      const tagRecords = taggedProfiles.map((profileId: string) => ({
        post_id: post.id,
        tagged_profile_id: profileId,
        created_by_profile_id: userId,
        status: 'active'
      }));

      const { error: tagError } = await supabase
        .from('post_tags')
        .insert(tagRecords);

      if (tagError) {
        console.error('Tag creation error during post creation:', tagError);
        // Don't fail the post creation if tags fail
      }
    }

    // Fetch the complete post with profile, media, and tagged profiles
    const { data: completePost, error: fetchError } = await supabase
      .from('posts')
      .select(`
        *,
        post_media (
          id,
          media_url,
          media_type,
          thumbnail_url,
          display_order
        ),
        profiles:profile_id (
          id,
          full_name,
          first_name,
          middle_name,
          last_name,
          avatar_url,
          visibility,
          handle
        ),
        created_by:created_by_user_id (
          id,
          first_name,
          last_name,
          full_name,
          handle
        ),
        post_likes (
          profile_id
        )
      `)
      .eq('id', post.id)
      .single();

    if (fetchError) {
      console.error('[POST] Error fetching complete post:', fetchError);
      // Return the basic post if fetch fails, but this shouldn't happen
      return NextResponse.json({
        success: true,
        post: post,
        message: 'Post created successfully!'
      });
    }

    // Verify profile data was fetched successfully
    if (!completePost.profiles) {
      console.error('[POST] Post created but profile data missing for post:', post.id);
      // Return basic post data without transformation
      return NextResponse.json({
        success: true,
        post: post,
        message: 'Post created successfully!'
      });
    }

    // Fetch golf round if exists (src/lib/golf/post-read.ts — the one
    // hydration slot for deep-table sports)
    let golfRound = null;
    if (completePost.round_id) {
      golfRound = await fetchGolfRoundById(supabase, completePost.round_id);
    }

    // Fetch tagged profiles if exists
    let taggedProfilesList: TaggedProfile[] = [];
    if (completePost.tags && completePost.tags.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, first_name, middle_name, last_name, full_name, avatar_url, handle')
        .in('id', completePost.tags);

      if (profiles) {
        taggedProfilesList = profiles;
      }
    }

    // Transform to match expected format
    const transformedPost = {
      id: completePost.id,
      caption: completePost.caption,
      sport_key: completePost.sport_key,
      post_category: completePost.post_category ?? null,
      stats_data: completePost.stats_data,
      visibility: completePost.visibility,
      status: completePost.status ?? 'published',
      tags: completePost.tags || [],
      hashtags: completePost.hashtags || [],
      created_at: completePost.created_at,
      likes_count: completePost.likes_count ?? 0,
      comments_count: completePost.comments_count ?? 0,
      saves_count: completePost.saves_count ?? 0,
      profile: {
        id: completePost.profiles.id,
        first_name: completePost.profiles.first_name,
        middle_name: completePost.profiles.middle_name,
        last_name: completePost.profiles.last_name,
        full_name: completePost.profiles.full_name,
        avatar_url: completePost.profiles.avatar_url,
        handle: completePost.profiles.handle
      },
      created_by: completePost.created_by ?? null,
      media: (completePost.post_media || [])
        .sort((a: { display_order: number }, b: { display_order: number }) => a.display_order - b.display_order)
        .map((media: { id: string; media_url: string; media_type: string; display_order: number; thumbnail_url: string | null }) => ({
          id: media.id,
          media_url: media.media_url,
          media_type: media.media_type,
          display_order: media.display_order,
          // Selected above and then dropped here, so PostCard's
          // poster={media.thumbnail_url} was ALWAYS undefined and every video
          // in the app rendered a black first frame.
          thumbnail_url: media.thumbnail_url ?? null
        })),
      likes: completePost.post_likes || [],
      golf_round: golfRound,
      tagged_profiles: taggedProfilesList,
      shared_post_id: completePost.shared_post_id ?? null,
      shared_post: null as ReturnType<typeof gateSharedPost>,
      reposts_count: completePost.reposts_count ?? 0
    };

    // Hydrate the quoted original so the feed's optimistic prepend renders
    // the full repost card. The creator just passed the repost gate, so
    // visibility is a formality — but run it through the same gate anyway.
    if (transformedPost.shared_post_id) {
      const { data: orig } = await supabase
        .from('posts')
        .select(SHARED_POST_SELECT)
        .eq('id', transformedPost.shared_post_id)
        .maybeSingle();
      const origOwner = orig ? (Array.isArray(orig.profile) ? orig.profile[0] : orig.profile) : null;
      transformedPost.shared_post = gateSharedPost(
        orig, userId,
        new Set(origOwner?.id ? [origOwner.id] : [])
      );
    }

    return NextResponse.json({
      success: true,
      post: transformedPost,
      message: 'Post created successfully!'
    });

  } catch (error) {
    console.error('Post creation error:', error);

    if (error instanceof Response) {
      return error;
    }

    return NextResponse.json({ error: 'Failed to create post' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const postId = searchParams.get('postId');
    const userId = searchParams.get('userId');
    const sportKey = searchParams.get('sportKey');
    // pinned=true → only the profile's Featured (pinned) posts, newest pin
    // first. Same privacy filters as the normal list apply below.
    const pinnedOnly = searchParams.get('pinned') === 'true';
    // scope=orgs → the feed's "My orgs" lens: posts by the viewer's org
    // peers, restricted to ALREADY anonymous-visible content. A scope, not
    // an access grant — main-feed only (ignored on profile/pinned modes).
    const orgScope = searchParams.get('scope') === 'orgs' && !userId && !pinnedOnly;
    // Guard against NaN (e.g. ?limit=abc) which would produce an invalid
    // .range() and 500. Clamp to sane bounds.
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10) || 20, 1), 100);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    // UUID_RE hoisted to module scope (reposts need it in POST too)
    if (postId && !UUID_RE.test(postId)) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }
    if (userId && !UUID_RE.test(userId)) {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 });
    }

    // Get current authenticated user (for privacy checks)
    let currentUserId: string | null = null;
    try {
      const user = await requireAuth(request);
      currentUserId = user.id;
    } catch {
      // Not authenticated - will only see public content
      currentUserId = null;
    }

    // If fetching a single post by ID
    if (postId) {
      const { data: post, error } = await supabase
        .from('posts')
        .select(`
          *,
          post_media (
            id,
            media_url,
            media_type,
            thumbnail_url,
            display_order
          ),
          profiles:profile_id (
            id,
            full_name,
            first_name,
            middle_name,
            last_name,
            avatar_url,
            visibility,
            handle
          ),
          created_by:created_by_user_id (
            id,
            first_name,
            last_name,
            full_name,
            handle
          ),
          post_likes (
            profile_id
          )
        `)
        .eq('id', postId)
        .maybeSingle();

      // maybeSingle() returns null (not an error) for a missing row, so a
      // bogus/deleted postId correctly yields 404 instead of a 500.
      if (error) {
        console.error('Post fetch error:', error);
        return NextResponse.json({ error: 'Failed to fetch post' }, { status: 500 });
      }

      if (!post) {
        return NextResponse.json({ error: 'Post not found' }, { status: 404 });
      }

      // Privacy gate — mirror the list branch's rules exactly (own post;
      // public post on public profile; accepted follower). This branch runs
      // on the admin client, so without this check anyone with a UUID could
      // read private posts. 404, not 403, so a hidden post's existence isn't
      // confirmed.
      const isOwnPost = currentUserId === post.profile_id;
      // Guardian access: approve_content holders may open their athletes'
      // posts (the approval queue reviews pending ones here). Resolved
      // lazily and memoized — the profile_access lookup only runs when a
      // cheaper gate would otherwise refuse.
      let guardianAllowed: boolean | null = null;
      const viewerIsGuardian = async (): Promise<boolean> => {
        if (guardianAllowed === null) {
          if (FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES && currentUserId && !isOwnPost) {
            const { getProfileRole } = await import('@/lib/auth-server');
            const { resolveProfileAction } = await import('@/lib/profile-roles');
            const role = await getProfileRole(currentUserId, post.profile_id);
            guardianAllowed = resolveProfileAction(role, 'approve_content');
          } else {
            guardianAllowed = false;
          }
        }
        return guardianAllowed;
      };
      // Pending/rejected posts are visible only to their author and their
      // guardians. Flag-gated: posts.status doesn't exist until migration
      // 051 runs.
      if (
        FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES &&
        post.status && post.status !== 'published' && !isOwnPost &&
        !(await viewerIsGuardian())
      ) {
        return NextResponse.json({ error: 'Post not found' }, { status: 404 });
      }
      const publiclyVisible = post.visibility === 'public' && post.profiles?.visibility === 'public';
      if (!isOwnPost && !publiclyVisible) {
        let allowed = false;
        if (currentUserId) {
          const { data: follow } = await supabase
            .from('follows')
            .select('id')
            .eq('follower_id', currentUserId)
            .eq('following_id', post.profile_id)
            .eq('status', 'accepted')
            .maybeSingle();
          allowed = !!follow;

          // Shared-round participants can always open the round's post: the
          // resume banner and useSharedRound's refresh deep-link here, and an
          // invited player need not follow the creator (or be able to see a
          // private profile) to score the round they're playing in.
          if (!allowed && post.group_post_id) {
            const { data: participantRow } = await supabase
              .from('group_post_participants')
              .select('status')
              .eq('group_post_id', post.group_post_id)
              .eq('profile_id', currentUserId)
              .maybeSingle();
            allowed = !!participantRow && isActiveParticipant(participantRow.status);
          }
        }
        // Guardians can view their (forced-private) athletes' posts without
        // a follow edge.
        if (!allowed) {
          allowed = await viewerIsGuardian();
        }
        if (!allowed) {
          return NextResponse.json({ error: 'Post not found' }, { status: 404 });
        }
      }

      // Check if profile data exists (critical for transformation)
      if (!post.profiles) {
        console.error('[GET] Post found but profile data missing:', postId);
        return NextResponse.json({
          error: 'Post profile data not found',
          details: 'The profile associated with this post no longer exists'
        }, { status: 404 });
      }

      // Fetch golf round if exists (src/lib/golf/post-read.ts)
      let golfRound = null;
      if (post.round_id) {
        golfRound = await fetchGolfRoundById(supabase, post.round_id);
      }

      // Fetch shared golf scorecard if exists (same shape as the feed list —
      // PostCard's targeted refetch after score entry depends on this)
      let groupScorecard = null;
      if (post.group_post_id) {
        const { data: groupData, error: groupError } = await supabase
          .from('group_posts')
          .select(GROUP_SCORECARD_SELECT)
          .eq('id', post.group_post_id)
          .maybeSingle();
        if (groupError) {
          console.error('[GET] Error fetching group scorecard (single):', groupError);
        } else {
          groupScorecard = transformGroupPostToScorecard(groupData);
        }
      }

      // Hydrate the quoted original for a repost, gated for THIS viewer —
      // an invisible original renders as a "post unavailable" placeholder.
      let sharedPost: ReturnType<typeof gateSharedPost> = null;
      if (post.shared_post_id) {
        const { data: orig } = await supabase
          .from('posts')
          .select(SHARED_POST_SELECT)
          .eq('id', post.shared_post_id)
          .maybeSingle();
        const origOwner = orig ? (Array.isArray(orig.profile) ? orig.profile[0] : orig.profile) : null;
        let followsOrigOwner = false;
        if (currentUserId && origOwner?.id && origOwner.id !== currentUserId) {
          const { data: follow } = await supabase
            .from('follows')
            .select('id')
            .eq('follower_id', currentUserId)
            .eq('following_id', origOwner.id)
            .eq('status', 'accepted')
            .maybeSingle();
          followsOrigOwner = !!follow;
        }
        sharedPost = gateSharedPost(
          orig, currentUserId,
          followsOrigOwner && origOwner?.id ? new Set([origOwner.id as string]) : new Set<string>()
        );
      }

      // Fetch tagged profiles if exists
      let taggedProfiles: TaggedProfile[] = [];
      if (post.tags && post.tags.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, first_name, middle_name, last_name, full_name, avatar_url, handle')
          .in('id', post.tags);

        if (profiles) {
          taggedProfiles = profiles;
        }
      }

      // Transform single post
      const transformedPost = {
        id: post.id,
        caption: post.caption,
        sport_key: post.sport_key,
        post_category: post.post_category ?? null,
        stats_data: post.stats_data,
        visibility: post.visibility,
        status: post.status ?? 'published',
        tags: post.tags || [],
        hashtags: post.hashtags || [],
        created_at: post.created_at,
        likes_count: post.likes_count ?? 0,
        comments_count: post.comments_count ?? 0,
        saves_count: post.saves_count ?? 0,
        is_pinned: post.is_pinned ?? false,
        pinned_at: post.pinned_at ?? null,
        profile: {
          id: post.profiles.id,
          first_name: post.profiles.first_name,
          middle_name: post.profiles.middle_name,
          last_name: post.profiles.last_name,
          full_name: post.profiles.full_name,
          avatar_url: post.profiles.avatar_url,
          handle: post.profiles.handle
        },
        // Attribution (090): the human author, when a guardian posted on
        // behalf of this profile. Null for self-authored posts.
        created_by: post.created_by ?? null,
        media: (post.post_media || [])
          .sort((a: { display_order: number }, b: { display_order: number }) => a.display_order - b.display_order)
          .map((media: { id: string; media_url: string; media_type: string; display_order: number; thumbnail_url: string | null }) => ({
            id: media.id,
            media_url: media.media_url,
            media_type: media.media_type,
            display_order: media.display_order,
            // Selected above and then dropped here, so PostCard's
            // poster={media.thumbnail_url} was ALWAYS undefined and every video
            // in the app rendered a black first frame.
            thumbnail_url: media.thumbnail_url ?? null
          })),
        likes: post.post_likes || [],
        golf_round: golfRound,
        group_scorecard: groupScorecard,
        tagged_profiles: taggedProfiles,
        shared_post_id: post.shared_post_id ?? null,
        shared_post: sharedPost,
        reposts_count: post.reposts_count ?? 0
      };

      return NextResponse.json({ post: transformedPost });
    }

    // Org lens: resolve the peer set up front — anonymous viewers and
    // viewers with no orgs get their empty envelope without touching posts.
    let orgPeerIds: string[] = [];
    if (orgScope) {
      if (!currentUserId) {
        return NextResponse.json({ posts: [], hasMore: false });
      }
      const { getOrgPeerIds } = await import('@/lib/affiliations/org-peers');
      orgPeerIds = await getOrgPeerIds(supabase, currentUserId);
      if (orgPeerIds.length === 0) {
        return NextResponse.json({ posts: [], hasMore: false, noOrgs: true });
      }
    }

    // Fetch posts with profile and follow relationship info
    let query = supabase
      .from('posts')
      .select(`
        *,
        post_media (
          id,
          media_url,
          media_type,
          thumbnail_url,
          display_order
        ),
        profiles:profile_id (
          id,
          full_name,
          first_name,
          middle_name,
          last_name,
          avatar_url,
          visibility,
          handle
        ),
        created_by:created_by_user_id (
          id,
          first_name,
          last_name,
          full_name,
          handle
        ),
        post_likes (
          profile_id
        )
      `)
      .order(pinnedOnly ? 'pinned_at' : 'created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Filter by user if provided
    if (userId) {
      query = query.eq('profile_id', userId);
    }

    // Org lens: SQL-level scope (keeps offset pagination coherent) — peers
    // only, public posts only; the author-visibility half of the rule is
    // applied in the filter below.
    if (orgScope) {
      query = query.in('profile_id', orgPeerIds).eq('visibility', 'public');
    }

    // Approval queue: unpublished posts never reach list surfaces — EXCEPT
    // for their own author (Round D, mirroring the comments viewer clause):
    // a supervised child must see their pending/rejected posts on their own
    // surfaces instead of watching them silently vanish.
    // Flag-gated — posts.status doesn't exist until migration 051 runs.
    // The org lens takes the strict published-only arm even for the author —
    // pending posts have no place in an org schedule of public content.
    if (FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      query = currentUserId && !orgScope
        ? query.or(`status.eq.published,profile_id.eq.${currentUserId}`)
        : query.eq('status', 'published');
    }

    if (pinnedOnly) {
      query = query.eq('is_pinned', true);
    }

    // Filter by sport if provided
    if (sportKey && sportKey !== 'all') {
      query = query.eq('sport_key', sportKey);
    }

    const { data: posts, error } = await query;

    if (error) {
      console.error('Posts fetch error:', error);
      return NextResponse.json({ error: 'Failed to fetch posts' }, { status: 500 });
    }

    // Get follow relationships for current user (if authenticated)
    let followingIds: Set<string> = new Set();
    if (currentUserId) {
      const { data: following } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', currentUserId)
        .eq('status', 'accepted');

      if (following) {
        followingIds = new Set(following.map(f => f.following_id));
      }
    }

    // Filter posts based on privacy rules
    const visiblePosts = (posts || []).filter(post => {
      if (!post.profiles) return false;

      const postOwner = post.profiles;
      const isOwnPost = currentUserId === post.profile_id;

      // Org lens: strictly anonymous-visible content (the activity-server
      // rule) — no own-post or follow exceptions widen it.
      if (orgScope) {
        return isOrgLensVisible(post.visibility, postOwner.visibility);
      }

      // Rule 1: User can always see their own posts
      if (isOwnPost) {
        return true;
      }

      // Rule 2: Post is public AND profile is public
      if (post.visibility === 'public' && postOwner.visibility === 'public') {
        return true;
      }

      // Rule 3: Viewer is connected (following the poster with accepted status)
      if (currentUserId && followingIds.has(post.profile_id)) {
        return true;
      }

      // If none of the above conditions are met, hide the post
      return false;
    });

    // Apply final visibility filter (organization-based features not yet implemented)
    const finalVisiblePosts = visiblePosts;

    // hasMore must reflect the RAW page size (pre-privacy-filter): a page
    // where many posts were filtered out used to make clients stop paginating
    // even though older visible posts exist.
    const rawPageCount = (posts || []).length;

    // Attach the viewer's saved state — PostCard reads post.saved_posts.
    // Without it every feed post rendered unsaved, and tapping the bookmark
    // on an already-saved post silently UNSAVED it (the endpoint toggles).
    let savedPostIds = new Set<string>();
    if (currentUserId && finalVisiblePosts.length > 0) {
      const { data: savedRows } = await supabase
        .from('saved_posts')
        .select('post_id')
        .eq('profile_id', currentUserId)
        .in('post_id', finalVisiblePosts.map(p => p.id));
      savedPostIds = new Set((savedRows || []).map(r => r.post_id));
    }

    // Batched enrichment — ONE query per data type instead of one per post.
    // (The old per-post Promise.all fired a deep group_posts query and a
    // golf_rounds query for EVERY post in the page: a feed of shared rounds
    // cost N nested round-trips.)
    const roundIds = [...new Set(finalVisiblePosts.map(p => p.round_id).filter(Boolean))];
    const groupPostIds = [...new Set(finalVisiblePosts.map(p => p.group_post_id).filter(Boolean))];
    const tagProfileIds = [...new Set(finalVisiblePosts.flatMap(p => p.tags || []))];
    const sharedPostIds = [...new Set(finalVisiblePosts.map(p => p.shared_post_id).filter(Boolean))];

    const [roundsResult, groupsResult, tagProfilesResult, sharedResult] = await Promise.all([
      fetchGolfRoundsByIds(supabase, roundIds as string[]),
      groupPostIds.length > 0
        ? supabase.from('group_posts').select(GROUP_SCORECARD_SELECT).in('id', groupPostIds)
        : Promise.resolve({ data: [], error: null }),
      tagProfileIds.length > 0
        ? supabase
            .from('profiles')
            .select('id, first_name, middle_name, last_name, full_name, avatar_url, handle')
            .in('id', tagProfileIds)
        : Promise.resolve({ data: [], error: null }),
      sharedPostIds.length > 0
        ? supabase.from('posts').select(SHARED_POST_SELECT).in('id', sharedPostIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (roundsResult.error) console.error('[GET] Error fetching golf rounds:', roundsResult.error);
    if (groupsResult.error) console.error('[GET] Error fetching group scorecards:', groupsResult.error);
    if (tagProfilesResult.error) console.error('[GET] Error fetching tagged profiles:', tagProfilesResult.error);
    if (sharedResult.error) console.error('[GET] Error fetching shared originals:', sharedResult.error);

    // Quoted originals, gated PER VIEWER with the followingIds set already in
    // scope — no extra follow queries.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sharedById = new Map<string, any>();
    for (const orig of sharedResult.data || []) {
      sharedById.set(orig.id, orig);
    }

    // Rounds arrive pre-sorted + keyed from post-read.ts
    const roundsById = roundsResult.byId;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scorecardsByGroupId = new Map<string, any>();
    for (const groupRow of groupsResult.data || []) {
      const scorecard = transformGroupPostToScorecard(groupRow);
      if (scorecard) scorecardsByGroupId.set(groupRow.id, scorecard);
    }

    const tagProfilesById = new Map<string, TaggedProfile>();
    for (const profile of tagProfilesResult.data || []) {
      tagProfilesById.set(profile.id, profile as TaggedProfile);
    }

    const postsWithRounds = finalVisiblePosts
      .map(post => ({
        ...post,
        golf_round: post.round_id ? roundsById.get(post.round_id) ?? null : null,
        group_scorecard: post.group_post_id ? scorecardsByGroupId.get(post.group_post_id) ?? null : null,
        shared_post: post.shared_post_id
          ? gateSharedPost(sharedById.get(post.shared_post_id), currentUserId, followingIds)
          : null,
        tagged_profiles: (post.tags || [])
          .map((id: string) => tagProfilesById.get(id))
          .filter((p: TaggedProfile | undefined): p is TaggedProfile => !!p),
      }))
      // Product rule: a round in progress is NOT a feed post yet — it lives
      // in the Live Now strip / banner / LIVE page while playing, and lands
      // in the feed (with a fresh timestamp) when it completes. Applies to
      // the FEED listing only: profile grids, pinned rows, and single-post
      // fetches keep every deep link working.
      .filter(post => {
        if (userId || pinnedOnly) return true;
        if (!post.group_scorecard) return true;
        return !isRoundLive(post.group_scorecard.group_post);
      });

    // Transform the data to match the expected format
    const transformedPosts = postsWithRounds
      .filter(post => {
        if (!post.profiles) {
          console.warn('[GET] Skipping post with missing profile data:', post.id);
          return false;
        }
        return true;
      })
      .map(post => ({
          id: post.id,
          caption: post.caption,
          sport_key: post.sport_key,
          post_category: post.post_category ?? null,
          stats_data: post.stats_data,
          visibility: post.visibility,
          status: post.status ?? 'published',
          tags: post.tags || [],
          hashtags: post.hashtags || [],
          created_at: post.created_at,
          likes_count: post.likes_count ?? 0,
          comments_count: post.comments_count ?? 0,
          saves_count: post.saves_count ?? 0,
          saved_posts: currentUserId && savedPostIds.has(post.id) ? [{ profile_id: currentUserId }] : [],
          is_pinned: post.is_pinned ?? false,
          pinned_at: post.pinned_at ?? null,
          profile: {
          id: post.profiles.id,
          first_name: post.profiles.first_name,
          middle_name: post.profiles.middle_name,
          last_name: post.profiles.last_name,
          full_name: post.profiles.full_name,
          avatar_url: post.profiles.avatar_url,
          handle: post.profiles.handle
        },
        // Attribution (090): the human author, when a guardian posted on
        // behalf of this profile. Null for self-authored posts.
        created_by: post.created_by ?? null,
        media: (post.post_media || [])
          .sort((a: { display_order: number }, b: { display_order: number }) => a.display_order - b.display_order)
          .map((media: { id: string; media_url: string; media_type: string; display_order: number; thumbnail_url: string | null }) => ({
            id: media.id,
            media_url: media.media_url,
            media_type: media.media_type,
            display_order: media.display_order,
            // Selected above and then dropped here, so PostCard's
            // poster={media.thumbnail_url} was ALWAYS undefined and every video
            // in the app rendered a black first frame.
            thumbnail_url: media.thumbnail_url ?? null
          })),
          likes: post.post_likes || [],
          golf_round: post.golf_round || null,
          group_scorecard: post.group_scorecard || null,
          tagged_profiles: post.tagged_profiles || [],
          shared_post_id: post.shared_post_id ?? null,
          shared_post: post.shared_post ?? null,
          reposts_count: post.reposts_count ?? 0
        }));

    return NextResponse.json({ posts: transformedPosts, hasMore: rawPageCount === limit });

  } catch (error) {
    console.error('Posts fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch posts' }, { status: 500 });
  }
}

/**
 * PATCH /api/posts — pin or unpin one of your own posts to the "Featured"
 * row on your profile. Body: { postId, action: 'pin' | 'unpin' }.
 * Cap (MAX_PINNED_POSTS) enforced here, mirroring comment pinning — but with
 * an explicit 400 instead of silent eviction: with 3 slots, auto-unpinning
 * the wrong one is worse than asking.
 */
// Acting-as parity (Round C): may this session manage content that lives on
// ownerId's profile? Owner always; a guardian of the profile via the matrix
// ('write_content'). The first thing a guardian tries after posting as their
// athlete is editing/deleting/pinning that post — hard owner-only checks
// made "Post as" a one-way door.
async function sessionMayManagePostContent(userId: string, ownerId: string): Promise<boolean> {
  if (userId === ownerId) return true;
  if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) return false;
  const { getProfileRole } = await import('@/lib/auth-server');
  const { resolveProfileAction } = await import('@/lib/profile-roles');
  return resolveProfileAction(await getProfileRole(userId, ownerId), 'write_content');
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);

    const body = await request.json();
    const { postId, action } = body;

    if (!postId || typeof postId !== 'string') {
      return NextResponse.json({ error: 'Post ID is required' }, { status: 400 });
    }
    if (!['pin', 'unpin', 'approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: "action must be 'pin', 'unpin', 'approve', or 'reject'" }, { status: 400 });
    }

    const { data: post, error: fetchError } = await supabase
      .from('posts')
      .select('id, profile_id, is_pinned, status')
      .eq('id', postId)
      .maybeSingle();

    if (fetchError) {
      console.error('[PATCH] Post fetch error:', fetchError);
      return NextResponse.json({ error: 'Failed to update post' }, { status: 500 });
    }
    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }
    // Approval-queue actions (guardian-profiles): guardians of the post's
    // profile publish or reject a supervised author's pending post.
    if (action === 'approve' || action === 'reject') {
      if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
        return NextResponse.json({ error: 'Not available' }, { status: 404 });
      }
      const { getProfileRole } = await import('@/lib/auth-server');
      const { resolveProfileAction } = await import('@/lib/profile-roles');
      const role = await getProfileRole(user.id, post.profile_id);
      if (!resolveProfileAction(role, 'approve_content')) {
        return NextResponse.json({ error: 'Guardian access required' }, { status: 403 });
      }
      if (post.status !== 'pending_approval') {
        return NextResponse.json({ error: 'This post is not awaiting approval' }, { status: 400 });
      }
      // Publishing a child's content requires approved consent — the same
      // promise the acting-as branch and the go-public gate enforce. The
      // child can WRITE pending posts regardless (invisible, so nothing is
      // displayed pre-consent); the guardian-facing approval is the
      // chokepoint where the consent CTA is actionable. Reject stays
      // ungated: a rejection is data minimization.
      if (action === 'approve') {
        const { getConsentState } = await import('@/lib/consent');
        const consent = await getConsentState(supabase, post.profile_id);
        if (consent !== 'approved') {
          return NextResponse.json(
            { error: 'Complete the consent review before approving posts.', code: 'consent_required' },
            { status: 403 }
          );
        }
      }
      const { error: statusError } = await supabase
        .from('posts')
        .update({ status: action === 'approve' ? 'published' : 'rejected' })
        .eq('id', postId);
      if (statusError) {
        return NextResponse.json({ error: 'Failed to update post' }, { status: 500 });
      }
      // Tell the supervised author what happened (their bell — they see it on
      // their next PIN login). Best-effort.
      {
        const { notifyUser } = await import('@/lib/guardian-notify');
        await notifyUser(supabase, post.profile_id, {
          type: 'post_approval_result',
          title: action === 'approve'
            ? 'Your post was approved and is now live'
            : "Your post wasn't approved",
          // Rejected posts stay openable by their author (Round D): the
          // single-post gate lets the author through, so the notification can
          // finally land somewhere instead of being a dead bell entry.
          actionUrl: `/feed?post=${postId}`,
          actorId: user.id,
          metadata: { post_id: postId, result: action },
        });
      }
      return NextResponse.json({ ok: true, status: action === 'approve' ? 'published' : 'rejected' });
    }

    if (!(await sessionMayManagePostContent(user.id, post.profile_id))) {
      return NextResponse.json({ error: 'You can only pin your own posts' }, { status: 403 });
    }

    if (action === 'pin' && !post.is_pinned) {
      const { count, error: countError } = await supabase
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', user.id)
        .eq('is_pinned', true);
      if (countError) {
        console.error('[PATCH] Pin count error:', countError);
        return NextResponse.json({ error: 'Failed to update post' }, { status: 500 });
      }
      if (!canPin(count ?? 0)) {
        return NextResponse.json(
          { error: `You can feature up to ${MAX_PINNED_POSTS} posts. Unpin one first.` },
          { status: 400 }
        );
      }
    }

    const { error: updateError } = await supabase
      .from('posts')
      .update(
        action === 'pin'
          ? { is_pinned: true, pinned_at: new Date().toISOString() }
          : { is_pinned: false, pinned_at: null }
      )
      .eq('id', postId);

    if (updateError) {
      console.error('[PATCH] Pin update error:', updateError);
      return NextResponse.json({ error: 'Failed to update post' }, { status: 500 });
    }

    return NextResponse.json({ success: true, action, is_pinned: action === 'pin' });
  } catch (error) {
    console.error('Post pin error:', error);
    if (error instanceof Response) {
      return error;
    }
    return NextResponse.json({ error: 'Failed to update post' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    // Require authentication
    const user = await requireAuth(request);

    const body = await request.json();
    const {
      postId,
      caption = '',
      taggedProfiles,
      hashtags = [],
      visibility
    } = body;

    if (!postId) {
      return NextResponse.json({ error: 'Post ID is required' }, { status: 400 });
    }

    // Validate visibility when provided; when omitted, the existing value is
    // preserved (defaulting to 'public' would silently flip private posts).
    if (visibility !== undefined && !['public', 'private'].includes(visibility)) {
      return NextResponse.json({ error: 'Invalid visibility setting' }, { status: 400 });
    }

    // First, verify the post belongs to the authenticated user
    const { data: existingPost, error: fetchError } = await supabase
      .from('posts')
      .select('profile_id, sport_key')
      .eq('id', postId)
      .single();

    if (fetchError || !existingPost) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    // Ownership or guardianship of the post's profile (Round C parity)
    if (!(await sessionMayManagePostContent(user.id, existingPost.profile_id))) {
      return NextResponse.json({ error: 'Unauthorized to edit this post' }, { status: 403 });
    }

    // Update the post
    const { data: updatedPost, error: updateError } = await supabase
      .from('posts')
      .update({
        caption: caption,
        ...(visibility !== undefined ? { visibility } : {}),
        hashtags: hashtags,
        updated_at: new Date().toISOString(),
        // tags = tagged people IDs. Only overwrite when the caller explicitly
        // sends taggedProfiles — EditPostModal doesn't, and defaulting to []
        // used to silently wipe every post's tagged people on edit.
        ...(Array.isArray(taggedProfiles) ? { tags: taggedProfiles } : {})
      })
      .eq('id', postId)
      .select()
      .single();

    if (updateError) {
      console.error('[PUT] Post update error:', updateError);
      return NextResponse.json({
        error: 'Failed to update post',
        details: updateError.message
      }, { status: 500 });
    }

    // Reconcile post_tags with the new tagged-people list. This used to be
    // skipped entirely, leaving post_tags permanently stale after any edit.
    // Upsert takes the ON CONFLICT UPDATE path for existing rows — the
    // notify trigger is AFTER INSERT, so only genuinely NEW tags notify.
    if (Array.isArray(taggedProfiles)) {
      try {
        if (taggedProfiles.length > 0) {
          await supabase
            .from('post_tags')
            .delete()
            .eq('post_id', postId)
            .not('tagged_profile_id', 'in', `(${taggedProfiles.join(',')})`);
          await supabase
            .from('post_tags')
            .upsert(taggedProfiles.map((taggedId: string) => ({
              post_id: postId,
              tagged_profile_id: taggedId,
              created_by_profile_id: user.id,
              status: 'active',
            })), { onConflict: 'post_id,tagged_profile_id' });
        } else {
          await supabase.from('post_tags').delete().eq('post_id', postId);
        }
      } catch (tagSyncError) {
        // Non-fatal: posts.tags (the read store) is already updated above.
        console.error('[PUT] post_tags reconciliation failed:', tagSyncError);
      }
    }

    return NextResponse.json({
      success: true,
      post: updatedPost,
      message: 'Post updated successfully!'
    });

  } catch (error) {
    console.error('Post update error:', error);

    if (error instanceof Response) {
      return error;
    }

    return NextResponse.json({ error: 'Failed to update post' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    // Require authentication
    const user = await requireAuth(request);

    const { searchParams } = new URL(request.url);
    const postId = searchParams.get('postId');

    if (!postId) {
      return NextResponse.json({ error: 'Post ID is required' }, { status: 400 });
    }

    // First, verify the post belongs to the authenticated user
    const { data: post, error: fetchError } = await supabase
      .from('posts')
      .select('profile_id, group_post_id')
      .eq('id', postId)
      .single();

    if (fetchError || !post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    // Ownership or guardianship of the post's profile (Round C parity)
    if (!(await sessionMayManagePostContent(user.id, post.profile_id))) {
      return NextResponse.json({ error: 'Unauthorized to delete this post' }, { status: 403 });
    }

    // A round's post IS the round (Tom's call, Aug 19): deleting it deletes
    // the whole round — group post, scores, mirrors — through the shared
    // cascade. Anything else would orphan a live round that keeps resolving
    // at /live and feeding stats. The post owner is the round creator by
    // construction, so the cascade's own authz check passes; if the round
    // row is somehow already gone (legacy orphan), fall through and delete
    // just the post.
    if (post.group_post_id) {
      // The cascade's own check requires the ROUND CREATOR — which is the
      // post's owner by construction. The session user was already verified
      // above (owner or guardian), so pass the owner id: a guardian deleting
      // their athlete's round must not trip the creator check.
      const roundResult = await deleteRoundCascade(supabase, post.group_post_id, post.profile_id);
      if (roundResult.status === 'deleted') {
        return NextResponse.json({ success: true, message: 'Round deleted successfully' });
      }
      if (roundResult.status === 'error') {
        return NextResponse.json({ error: roundResult.message }, { status: 500 });
      }
      // not_found / forbidden → legacy orphan or mismatched creator: the
      // caller still owns THIS post, so plain post deletion proceeds.
    }

    const result = await deletePostCascade(supabase, postId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Post deleted successfully' });

  } catch (error) {
    console.error('Post deletion error:', error);

    if (error instanceof Response) {
      return error;
    }

    return NextResponse.json({ error: 'Failed to delete post' }, { status: 500 });
  }
}