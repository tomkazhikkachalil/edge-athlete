import { NextRequest, NextResponse } from 'next/server';
import { getEnabledSports } from '@/lib/sports/SportRegistry';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { GROUP_SCORECARD_SELECT, transformGroupPostToScorecard } from '@/lib/golf/scorecard-transform';
import { isActiveParticipant } from '@/lib/golf/round-status';
import { canPin, MAX_PINNED_POSTS } from '@/lib/posts/pinning';

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

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    // Require authentication
    const user = await requireAuth(request);

    const body = await request.json();
    const {
      postType = 'general', // 'general', 'golf', or 'training'
      caption = '',
      hashtags = [],
      visibility = 'public',
      media = [],
      golfData = null,
      taggedProfiles = [], // Array of profile IDs to tag in this post
      stats_data: incomingStatsData = null, // Optional structured metadata (e.g. vitals_entry)
    } = body;

    // Use authenticated user's ID
    const userId = user.id;

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
    } = {
      profile_id: userId,
      sport_key: postType, // Use postType as sport_key for our unified approach
      caption: caption,
      visibility: visibility,
      tags: taggedProfiles, // Store tagged people IDs (not category tags)
      hashtags: hashtags,
      likes_count: 0,
      comments_count: 0,
      ...(incomingStatsData && postType !== 'golf' ? { stats_data: incomingStatsData } : {}),
    };

    let roundId: string | null = null;

    // Create golf entities if provided (comprehensive scorecard)
    if (postType === 'golf' && golfData) {
      // A second same-day/same-course post may REUSE the existing round, but
      // only when it brings no new hole data — the old behavior overwrote the
      // round's metadata and delete-reinserted its holes, silently rewriting
      // the FIRST post's scorecard (both posts share round_id).
      const hasNewHoleData = !!(golfData.holesData && golfData.holesData.length > 0);
      const { data: existingRounds } = await supabase
        .from('golf_rounds')
        .select('id')
        .eq('profile_id', userId)
        .eq('date', golfData.date)
        .eq('course', golfData.courseName)
        .limit(1);

      if (existingRounds && existingRounds.length > 0 && !hasNewHoleData) {
        // Attach this post to the existing round as-is (no rewrite)
        roundId = existingRounds[0].id;
      } else {
        // Create new comprehensive round
        const { data: newRound, error: roundError } = await supabase
          .from('golf_rounds')
          .insert({
            profile_id: userId,
            date: golfData.date,
            course: golfData.courseName,
            course_location: golfData.courseLocation || null,
            tee: golfData.teeBox || null,
            holes: parseInt(golfData.holes) || 18,
            round_type: golfData.roundType || 'outdoor',
            par: golfData.coursePar || 72,
            weather: golfData.weather || null,
            temperature: golfData.temperature || null,
            wind: golfData.wind || null,
            course_rating: golfData.courseRating || null,
            slope_rating: golfData.courseSlope || null
          })
          .select()
          .single();

        if (roundError || !newRound) {
          // The post hasn't been created yet — abort so the user's full
          // hole-by-hole entry isn't silently discarded behind a "success".
          console.error('Round creation error:', roundError);
          return NextResponse.json({ error: 'Failed to save golf round' }, { status: 500 });
        }
        roundId = newRound.id;
      }

      // Now handle hole-by-hole data
      if (roundId && golfData.holesData && golfData.holesData.length > 0) {
        const holeRecords = golfData.holesData
          .filter((hole: { score?: number }) => hole.score !== undefined)
          .map((hole: { hole: number; par: number; yardage?: number; score: number; putts?: number; fairway?: string; gir?: boolean; notes?: string }) => ({
            round_id: roundId,
            hole_number: hole.hole,
            par: hole.par,
            distance_yards: hole.yardage,
            strokes: hole.score,
            putts: hole.putts,
            fairway_hit: hole.fairway === 'hit' ? true : hole.fairway === 'na' ? null : false,
            green_in_regulation: hole.gir || false,
            notes: hole.notes || null
          }));

        if (holeRecords.length > 0) {
          // Delete existing holes for this round first
          await supabase
            .from('golf_holes')
            .delete()
            .eq('round_id', roundId);

          // Insert new hole data
          const { error: holesError } = await supabase
            .from('golf_holes')
            .insert(holeRecords);

          if (holesError) {
            console.error('Holes creation error:', holesError);
            // Pre-post: abort rather than leave a zero-hole round and a
            // "successful" post with a missing scorecard.
            await supabase.from('golf_rounds').delete().eq('id', roundId);
            return NextResponse.json({ error: 'Failed to save hole-by-hole scores' }, { status: 500 });
          }

          // Calculate round stats
          try {
            await supabase.rpc('calculate_round_stats', { round_uuid: roundId });
          } catch (statsError) {
            console.error('Stats calculation error:', statsError);
          }
        }
      }

      // Add golf references to post.
      // activity_mode is the sport-agnostic column (migration 020).
      // golf_mode dual-write removed — the column is dropped in migration 023.
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

    // Fetch golf round if exists
    let golfRound = null;
    if (completePost.round_id) {
      const { data: roundData } = await supabase
        .from('golf_rounds')
        .select(`
          *,
          golf_holes (
            hole_number,
            par,
            strokes,
            putts,
            fairway_hit,
            green_in_regulation,
            distance_yards,
            club_off_tee,
            notes
          )
        `)
        .eq('id', completePost.round_id)
        .single();

      if (roundData && roundData.golf_holes) {
        roundData.golf_holes.sort((a: { hole_number: number }, b: { hole_number: number }) => a.hole_number - b.hole_number);
      }
      golfRound = roundData;
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
      stats_data: completePost.stats_data,
      visibility: completePost.visibility,
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
      media: (completePost.post_media || [])
        .sort((a: { display_order: number }, b: { display_order: number }) => a.display_order - b.display_order)
        .map((media: { id: string; media_url: string; media_type: string; display_order: number }) => ({
          id: media.id,
          media_url: media.media_url,
          media_type: media.media_type,
          display_order: media.display_order
        })),
      likes: completePost.post_likes || [],
      golf_round: golfRound,
      tagged_profiles: taggedProfilesList
    };

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
    // Guard against NaN (e.g. ?limit=abc) which would produce an invalid
    // .range() and 500. Clamp to sane bounds.
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10) || 20, 1), 100);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    // Reject non-UUID ids up front (garbage used to hit PostgREST as 22P02 → 500)
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

      // Fetch golf round if exists
      let golfRound = null;
      if (post.round_id) {
        const { data: roundData } = await supabase
          .from('golf_rounds')
          .select(`
            *,
            golf_holes (
              hole_number,
              par,
              strokes,
              putts,
              fairway_hit,
              green_in_regulation,
              distance_yards,
              club_off_tee,
              notes
            )
          `)
          .eq('id', post.round_id)
          .single();

        if (roundData && roundData.golf_holes) {
          roundData.golf_holes.sort((a: { hole_number: number }, b: { hole_number: number }) => a.hole_number - b.hole_number);
        }
        golfRound = roundData;
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
        stats_data: post.stats_data,
        visibility: post.visibility,
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
        media: (post.post_media || [])
          .sort((a: { display_order: number }, b: { display_order: number }) => a.display_order - b.display_order)
          .map((media: { id: string; media_url: string; media_type: string; display_order: number }) => ({
            id: media.id,
            media_url: media.media_url,
            media_type: media.media_type,
            display_order: media.display_order
          })),
        likes: post.post_likes || [],
        golf_round: golfRound,
        group_scorecard: groupScorecard,
        tagged_profiles: taggedProfiles
      };

      return NextResponse.json({ post: transformedPost });
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

    const [roundsResult, groupsResult, tagProfilesResult] = await Promise.all([
      roundIds.length > 0
        ? supabase
            .from('golf_rounds')
            .select(`
              *,
              golf_holes (
                hole_number, par, strokes, putts, fairway_hit,
                green_in_regulation, distance_yards, club_off_tee, notes
              )
            `)
            .in('id', roundIds)
        : Promise.resolve({ data: [], error: null }),
      groupPostIds.length > 0
        ? supabase.from('group_posts').select(GROUP_SCORECARD_SELECT).in('id', groupPostIds)
        : Promise.resolve({ data: [], error: null }),
      tagProfileIds.length > 0
        ? supabase
            .from('profiles')
            .select('id, first_name, middle_name, last_name, full_name, avatar_url, handle')
            .in('id', tagProfileIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (roundsResult.error) console.error('[GET] Error fetching golf rounds:', roundsResult.error);
    if (groupsResult.error) console.error('[GET] Error fetching group scorecards:', groupsResult.error);
    if (tagProfilesResult.error) console.error('[GET] Error fetching tagged profiles:', tagProfilesResult.error);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const roundsById = new Map<string, any>();
    for (const round of roundsResult.data || []) {
      if (round.golf_holes) {
        round.golf_holes.sort((a: { hole_number: number }, b: { hole_number: number }) => a.hole_number - b.hole_number);
      }
      roundsById.set(round.id, round);
    }

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

    const postsWithRounds = finalVisiblePosts.map(post => ({
      ...post,
      golf_round: post.round_id ? roundsById.get(post.round_id) ?? null : null,
      group_scorecard: post.group_post_id ? scorecardsByGroupId.get(post.group_post_id) ?? null : null,
      tagged_profiles: (post.tags || [])
        .map((id: string) => tagProfilesById.get(id))
        .filter((p: TaggedProfile | undefined): p is TaggedProfile => !!p),
    }));

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
          stats_data: post.stats_data,
          visibility: post.visibility,
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
        media: (post.post_media || [])
          .sort((a: { display_order: number }, b: { display_order: number }) => a.display_order - b.display_order)
          .map((media: { id: string; media_url: string; media_type: string; display_order: number }) => ({
            id: media.id,
            media_url: media.media_url,
            media_type: media.media_type,
            display_order: media.display_order
          })),
          likes: post.post_likes || [],
          golf_round: post.golf_round || null,
          group_scorecard: post.group_scorecard || null,
          tagged_profiles: post.tagged_profiles || []
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
export async function PATCH(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);

    const body = await request.json();
    const { postId, action } = body;

    if (!postId || typeof postId !== 'string') {
      return NextResponse.json({ error: 'Post ID is required' }, { status: 400 });
    }
    if (action !== 'pin' && action !== 'unpin') {
      return NextResponse.json({ error: "action must be 'pin' or 'unpin'" }, { status: 400 });
    }

    const { data: post, error: fetchError } = await supabase
      .from('posts')
      .select('id, profile_id, is_pinned')
      .eq('id', postId)
      .maybeSingle();

    if (fetchError) {
      console.error('[PATCH] Post fetch error:', fetchError);
      return NextResponse.json({ error: 'Failed to update post' }, { status: 500 });
    }
    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }
    if (post.profile_id !== user.id) {
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

    // Check ownership
    if (existingPost.profile_id !== user.id) {
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
      .select('profile_id')
      .eq('id', postId)
      .single();

    if (fetchError || !post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    // Check ownership
    if (post.profile_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized to delete this post' }, { status: 403 });
    }

    // Remove the media FILES from storage (best effort — DB rows cascade,
    // but files never did, orphaning storage forever). Only paths we manage.
    const { data: mediaRows } = await supabase
      .from('post_media')
      .select('media_url')
      .eq('post_id', postId);
    if (mediaRows && mediaRows.length > 0) {
      const byBucket = new Map<string, string[]>();
      for (const row of mediaRows) {
        const m = /\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/.exec(row.media_url || '');
        if (m) {
          const paths = byBucket.get(m[1]) || [];
          paths.push(decodeURIComponent(m[2]));
          byBucket.set(m[1], paths);
        }
      }
      for (const [bucket, paths] of byBucket) {
        const { error: storageError } = await supabase.storage.from(bucket).remove(paths);
        if (storageError) console.warn('[DELETE] Storage cleanup failed:', storageError);
      }
    }

    // Delete associated media records first (cascade should handle this, but being explicit)
    await supabase
      .from('post_media')
      .delete()
      .eq('post_id', postId);

    // Delete associated likes
    await supabase
      .from('post_likes')
      .delete()
      .eq('post_id', postId);

    // Delete the post
    const { error: deleteError } = await supabase
      .from('posts')
      .delete()
      .eq('id', postId);

    if (deleteError) {
      console.error('[DELETE] Post deletion error:', deleteError);
      return NextResponse.json({ error: 'Failed to delete post' }, { status: 500 });
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