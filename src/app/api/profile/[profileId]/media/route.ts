import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getSupabaseAdmin, getServerAuth } from '@/lib/auth-server';
import { parseTrainingPrivacy } from '@/lib/training-privacy';
import { countActivities } from '@/lib/activities/read-server';
import { canViewProfile } from '@/lib/privacy';
import { participantOrder } from '@/lib/golf/scorecard-transform';
import { canViewSharedPost } from '@/lib/reposts';
import { toProxyUrl } from '@/lib/media/proxy-url';
import { reportRouteError } from '@/lib/observability/report';

interface MediaItem {
  id: string;
  caption: string | null;
  sport_key: string | null;
  stats_data: Record<string, unknown> | null;
  round_id?: string | null;
  visibility: string;
  created_at: string;
  profile_id: string;
  profile_first_name: string | null;
  profile_last_name: string | null;
  profile_full_name: string | null;
  profile_avatar_url: string | null;
  media_count: number;
  likes_count: number;
  comments_count: number;
  saves_count: number;
  tags: string[] | null;
  hashtags: string[] | null;
  is_own_post: boolean;
  is_tagged: boolean;
  /** Set for the owner on their own grid only (241): hidden from the profile. */
  profile_hidden?: boolean;
}

/** The slice of a shared round a TILE needs: course, and who scored what.
 *  Deliberately not GROUP_SCORECARD_SELECT, which drags in every hole score
 *  and all round media for a 159px thumbnail. Shaped to match what
 *  transformGroupPostToScorecard produces so buildStatHighlights consumes it
 *  unchanged, and a tile can never disagree with its own expanded card. */
interface TileScorecard {
  group_post: { id: string; date: string | null };
  golf_data: { course_name: string | null; holes_played: number | null; game_format: string | null } | null;
  participants: Array<{
    participant: {
      profile_id: string | null;
      profile: {
        first_name: string | null;
        last_name: string | null;
        full_name: string | null;
        avatar_url: string | null;
      } | null;
    };
    scores: { total_score: number | null; to_par: number | null } | null;
  }>;
}

interface MediaAttachment {
  id: string;
  post_id: string;
  media_url: string;
  media_type: string;
  display_order: number;
  thumbnail_url?: string | null;
  blur_hash?: string | null;
  codec?: string | null;
  processing_at?: string | null;
  /** What the API emits in place of the timestamp. */
  processing?: boolean;
}

interface TaggedProfile {
  id: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  handle: string | null;
}

interface GolfRound {
  id: string;
  profile_id: string;
  date: string;
  course: string;
  course_location: string | null;
  tee: string | null;
  holes: number;
  round_type: string;
  par: number;
  gross_score: number | null;
  total_putts: number | null;
  fir_percentage: number | null;
  gir_percentage: number | null;
  weather: string | null;
  temperature: number | null;
  wind: string | null;
  conditions_source?: 'manual' | 'forecast' | null;
  conditions_at?: string | null;
  course_rating: number | null;
  slope_rating: number | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);

    // Get authenticated user (optional - public profiles work without auth)
    const { supabase, user } = await getServerAuth(request);
    const viewerId = user?.id || null;

    // Parameters (await params in Next.js 15)
    const { profileId } = await params;
    if (!isUuid(profileId)) {
      return NextResponse.json({ error: 'Invalid profile ID' }, { status: 400 });
    }
    const tab = searchParams.get('tab') || 'all'; // all | stats | tagged | statements
    // NaN-guard (?limit=abc used to reach the RPC and 500)
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10) || 20, 1), 100);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);
    const sort = searchParams.get('sort') || 'newest'; // newest | most_engaged
    // mediaType 'posts' = media-tab posts with or without attachments (stats/
    // round posts have no post_media rows). Pure text posts are statements
    // since migration 074 and never reach tab=all, so 'posts' no longer
    // means "text posts included".
    const mediaType = searchParams.get('mediaType') || 'all'; // all | photos | videos | posts

    // Sport / year filters: comma-separated. Empty / missing = no filter (NULL to RPC).
    const sportKeysParam = searchParams.get('sportKeys');
    const filterSportKeys: string[] | null = sportKeysParam
      ? sportKeysParam.split(',').map(s => s.trim()).filter(Boolean)
      : null;
    const yearsParam = searchParams.get('years');
    const filterYears: number[] | null = yearsParam
      ? yearsParam.split(',').map(y => parseInt(y, 10)).filter(n => Number.isInteger(n) && n > 1900 && n < 2200)
      : null;

    if (!profileId) {
      return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
    }

    // Privacy gate: a private profile's media must not be returned to viewers
    // who can't see the profile. The get_profile_*_media RPCs take viewer_id
    // but don't reliably gate profile-level visibility, so enforce it here.
    // Only gate PRIVATE profiles — public profiles are viewable by anyone
    // (including anonymous viewers), and canViewProfile() returns false for a
    // null viewer regardless of visibility, so we must not call it for public
    // profiles.
    // Read for EVERY viewer (owner too): the owner's visibility also decides
    // which URL form the media gets below (speed round 2).
    const { data: targetProfile } = await supabaseAdmin
      .from('profiles')
      .select('visibility')
      .eq('id', profileId)
      .single();
    if (!targetProfile) {
      return NextResponse.json({ items: [], hasMore: false });
    }
    const ownerPublic = targetProfile.visibility === 'public';
    if (viewerId !== profileId) {
      if (!ownerPublic) {
        const { canView } = await canViewProfile(profileId, viewerId);
        if (!canView) {
          return NextResponse.json({ items: [], hasMore: false });
        }
      }
    }

    // Validate tab
    if (!['all', 'stats', 'tagged', 'statements'].includes(tab)) {
      return NextResponse.json({ error: 'Invalid tab. Use: all, stats, tagged, or statements' }, { status: 400 });
    }

    // Select appropriate database function based on tab
    let functionName = 'get_profile_all_media';
    if (tab === 'stats') {
      functionName = 'get_profile_stats_media';
    } else if (tab === 'tagged') {
      functionName = 'get_profile_tagged_media';
    } else if (tab === 'statements') {
      functionName = 'get_profile_statements_media';
    }

    // Build RPC payload — only include filter args when they're actually set so
    // the call resolves against the original 4-arg signature when no filter is
    // applied. This keeps the unfiltered default view working whether or not
    // migration 018 (which adds the filter args) has been applied yet.
    const rpcParams: Record<string, unknown> = {
      target_profile_id: profileId,
      viewer_id: viewerId,
      media_limit: limit,
      media_offset: offset,
    };
    if (filterSportKeys && filterSportKeys.length > 0) {
      rpcParams.filter_sport_keys = filterSportKeys;
    }
    if (filterYears && filterYears.length > 0) {
      rpcParams.filter_years = filterYears;
    }

    const { data: mediaItems, error: mediaError } = await supabaseAdmin.rpc(functionName, rpcParams);

    if (mediaError) {
      reportRouteError(`Error fetching ${tab} media:`, mediaError);
      reportRouteError('Function called:', functionName);
      reportRouteError('Filter params present:', {
        sportKeys: !!rpcParams.filter_sport_keys,
        years: !!rpcParams.filter_years,
      });
      if (rpcParams.filter_sport_keys || rpcParams.filter_years) {
        reportRouteError('Hint: ensure migration 018_profile_media_sport_year_filters.sql is applied in Supabase.');
      }
      return NextResponse.json({ error: 'Failed to fetch media' }, { status: 500 });
    }

    let items = mediaItems as MediaItem[] || [];
    // Pagination must be computed from the RAW page (pre-filter): the media-
    // type filter shrinks the page, and using the filtered count made
    // hasMore false too early and nextOffset re-read consumed rows
    // (duplicate tiles + duplicate React keys under Photos/Videos filters).
    const rawCount = items.length;

    // ── One pass over the page in three stages (SCALE_AUDIT hole 10, Nov 6
    // 2026). This used to be up to fourteen reads one after another; the
    // independent ones now run together, and the three reads of `posts` for
    // the same ids (the shared-round link, the repost link, the owner's
    // hidden rows) are ONE read. Trips for a plain page: 6 → 4.
    if (items.length > 0) {
      const postIds = items.map((item: MediaItem) => item.id);
      const allTagIds = new Set<string>();
      items.forEach((item: MediaItem) => item.tags?.forEach(tagId => allTagIds.add(tagId)));
      const roundIds = items.filter((item: MediaItem) => item.round_id).map((item: MediaItem) => item.round_id as string);

      // Stage 2: everything the page ids alone decide.
      const [mediaRes, linksRes, profilesRes, roundsRes] = await Promise.all([
        // Attachments (thumbnail_url = video poster frames — the grid renders
        // videos as posters, never raw <video> elements). The same rows feed
        // the Photos / Videos filter below — no separate read for it.
        supabase
          .from('post_media')
          .select('id, post_id, media_url, media_type, display_order, thumbnail_url, blur_hash, codec, processing_at')
          .in('post_id', postIds)
          .order('display_order', { ascending: true }),
        // The links the RPC rows do not carry (a SHARED round's group_post_id,
        // a REPOST's shared_post_id) and the owner's hidden status, for the
        // ids the RPC already visibility-vetted.
        supabaseAdmin.from('posts').select('id, group_post_id, shared_post_id, status').in('id', postIds),
        allTagIds.size > 0
          ? supabase
              .from('profiles')
              .select('id, first_name, middle_name, last_name, full_name, avatar_url, handle')
              .in('id', Array.from(allTagIds))
          : Promise.resolve({ data: null, error: null }),
        roundIds.length > 0
          ? supabaseAdmin.from('golf_rounds').select('*').in('id', roundIds)
          : Promise.resolve({ data: null, error: null }),
      ]);
      const media = (mediaRes.data ?? []) as MediaAttachment[];
      if (linksRes.error) reportRouteError('[PROFILE MEDIA API] Error fetching post links:', linksRes.error);
      if (roundsRes.error) reportRouteError('[PROFILE MEDIA API] Error fetching golf rounds:', roundsRes.error);
      const links = (linksRes.data ?? []) as { id: string; group_post_id: string | null; shared_post_id: string | null; status: string | null }[];

      // Client-side filtering for media type, from the attachments read.
      if (mediaType !== 'all') {
        const postMediaMap = new Map<string, { hasVideo: boolean; hasPhoto: boolean }>();
        media.forEach(m => {
          if (!postMediaMap.has(m.post_id)) postMediaMap.set(m.post_id, { hasVideo: false, hasPhoto: false });
          const entry = postMediaMap.get(m.post_id)!;
          if (m.media_type === 'video') entry.hasVideo = true;
          if (m.media_type === 'image') entry.hasPhoto = true;
        });
        items = items.filter((item: MediaItem) => {
          const mediaInfo = postMediaMap.get(item.id);
          if (!mediaInfo && mediaType !== 'posts') return false; // Attachment-less (stats/round) posts only match 'posts' filter
          if (mediaType === 'photos') return mediaInfo?.hasPhoto || false;
          if (mediaType === 'videos') return mediaInfo?.hasVideo || false;
          return true; // 'posts': with or without media
        });
      }

      // Apply sorting ('newest' is already sorted by created_at DESC in SQL)
      if (sort === 'most_engaged') {
        items.sort((a: MediaItem, b: MediaItem) => {
          const engagementA = (a.likes_count || 0) + (a.comments_count || 0) + (a.saves_count || 0);
          const engagementB = (b.likes_count || 0) + (b.comments_count || 0) + (b.saves_count || 0);
          return engagementB - engagementA;
        });
      }

      // Attach media to posts — proxy protected-bucket bytes (the viewer is
      // re-authorized at load; post_id is the governing entity).
      const mediaMap = new Map<string, MediaAttachment[]>();
      // The URL form follows what this reader knows (speed round 2): a public
      // post of a public owner gets the optimizable form, a private post an
      // expiring one, anything else the stable bare path.
      const postVisibility = new Map(items.map((item: MediaItem) => [item.id, item.visibility]));
      const lifeOf = (postId: string) => {
        const v = postVisibility.get(postId);
        if (v === 'private') return { visibility: 'private' as const };
        if (v === 'public' && ownerPublic) return { visibility: 'public' as const };
        return {};
      };
      media.forEach((m: MediaAttachment) => {
        if (!mediaMap.has(m.post_id)) mediaMap.set(m.post_id, []);
        const { processing_at, ...rest } = m;
        mediaMap.get(m.post_id)!.push({
          ...rest,
          media_url: toProxyUrl(m.media_url, { type: 'post', id: m.post_id }, lifeOf(m.post_id)) ?? m.media_url,
          thumbnail_url: toProxyUrl(m.thumbnail_url, { type: 'post', id: m.post_id }, lifeOf(m.post_id)),
          // 261 / PR 8: whether the worker still owes the playable file — never the timestamp.
          processing: !!processing_at,
        });
      });

      // Tagged profiles per post.
      const taggedProfilesMap = new Map<string, TaggedProfile[]>();
      const profileMap = new Map((profilesRes.data ?? []).map(p => [p.id, p]));
      items.forEach((item: MediaItem) => {
        if (item.tags && item.tags.length > 0) {
          taggedProfilesMap.set(
            item.id,
            item.tags.map(tagId => profileMap.get(tagId)).filter((profile): profile is TaggedProfile => profile !== undefined)
          );
        }
      });

      const golfRoundsMap = new Map<string, GolfRound>();
      ((roundsRes.data ?? []) as GolfRound[]).forEach(round => golfRoundsMap.set(round.id, round));

      // Stage 3: what the links point at — the SHARED rounds' scorecards and
      // the REPOSTS' originals, together.
      const groupLinks = links.filter(l => l.group_post_id);
      const repostLinks = links.filter(l => l.shared_post_id);
      const groupPostIds = [...new Set(groupLinks.map(l => l.group_post_id as string))];
      const originalIds = [...new Set(repostLinks.map(l => l.shared_post_id as string))];
      const [groupRes, originalsRes] = await Promise.all([
        groupPostIds.length > 0
          ? supabaseAdmin
              .from('group_posts')
              .select(`
                id,
                date,
                golf_data:golf_scorecard_data ( course_name, holes_played, game_format ),
                participants:group_post_participants (
                  id,
                  profile_id,
                  position,
                  created_at,
                  profile:profiles ( first_name, last_name, full_name, avatar_url ),
                  scores:golf_participant_scores ( total_score, to_par )
                )
              `)
              .in('id', groupPostIds)
          : Promise.resolve({ data: null, error: null }),
        originalIds.length > 0
          ? supabaseAdmin
              .from('posts')
              .select(`
                id, caption, visibility, status, created_at, profile_id,
                profile:profile_id ( id, first_name, last_name, full_name, avatar_url, handle, visibility ),
                media:post_media ( media_url, media_type )
              `)
              .in('id', originalIds)
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (groupRes.error) reportRouteError('[PROFILE MEDIA API] Error fetching shared rounds:', groupRes.error);
      if (originalsRes.error) reportRouteError('[PROFILE MEDIA API] Error fetching repost originals:', originalsRes.error);

      // SHARED rounds: the scorecard tile (the feed's scorecard contract).
      const scorecardsByPostId = new Map<string, TileScorecard>();
      const byGroupId = new Map<string, TileScorecard>();
      for (const row of groupRes.data || []) {
        // Supabase returns to-one embeds as arrays; normalise here so the
        // shape matches the feed's scorecard contract exactly.
        const golfData = Array.isArray(row.golf_data) ? row.golf_data[0] : row.golf_data;
        byGroupId.set(row.id, {
          group_post: { id: row.id, date: row.date ?? null },
          golf_data: golfData ?? null,
          // Canonical creation order — same comparator as the feed's
          // scorecard transform, so tiles and cards agree.
          participants: (row.participants || []).slice().sort(participantOrder).map((p: Record<string, unknown>) => {
            const profile = Array.isArray(p.profile) ? p.profile[0] : p.profile;
            const scores = Array.isArray(p.scores) ? p.scores[0] : p.scores;
            return {
              participant: {
                profile_id: (p.profile_id as string) ?? null,
                profile: (profile as TileScorecard['participants'][number]['participant']['profile']) ?? null,
              },
              scores: (scores as TileScorecard['participants'][number]['scores']) ?? null,
            };
          }),
        });
      }
      for (const link of groupLinks) {
        const card = byGroupId.get(link.group_post_id as string);
        if (card) scorecardsByPostId.set(link.id, card);
      }

      // REPOSTS: hydrate + per-viewer-gate the quoted originals (the feed's
      // read-time rule via canViewSharedPost). The one follows read is
      // bounded by the originals' owners.
      const repostLinkByPostId = new Map<string, string>();
      for (const link of repostLinks) repostLinkByPostId.set(link.id, link.shared_post_id as string);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sharedPostByPostId = new Map<string, any>();
      const originals = originalsRes.data || [];
      if (originals.length > 0) {
        const ownerIds = [...new Set(originals.map(o => o.profile_id as string))];
        let viewerFollows = new Set<string>();
        if (viewerId && ownerIds.length > 0) {
          const { data: follows } = await supabaseAdmin
            .from('follows')
            .select('following_id')
            .eq('follower_id', viewerId)
            .in('following_id', ownerIds)
            .eq('status', 'accepted');
          viewerFollows = new Set((follows || []).map(f => f.following_id as string));
        }
        for (const orig of originals) {
          const owner = Array.isArray(orig.profile) ? orig.profile[0] : orig.profile;
          if (!owner?.id) continue;
          if (orig.status && orig.status !== 'published' && orig.profile_id !== viewerId) continue;
          const visible = canViewSharedPost({
            postVisibility: orig.visibility as string,
            ownerVisibility: owner.visibility as string,
            isOwner: viewerId === owner.id,
            isFollower: viewerFollows.has(owner.id as string),
          });
          if (!visible) continue;
          sharedPostByPostId.set(orig.id as string, {
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
            media: orig.media || [],
          });
        }
      }

      // The owner's own grid keeps the results they hid from their profile
      // (the RPCs' owner arm) — mark them, so the tile and the opened post can
      // say so and offer "Show on profile". Nobody else is ever sent one.
      const hiddenIds = new Set(viewerId === profileId ? links.filter(l => l.status === 'profile_hidden').map(l => l.id) : []);

      items = items.map((item: MediaItem) => ({
        ...item,
        media: mediaMap.get(item.id) || [],
        tagged_profiles: taggedProfilesMap.get(item.id) || [],
        golf_round: item.round_id ? golfRoundsMap.get(item.round_id) || null : null,
        group_scorecard: scorecardsByPostId.get(item.id) || null,
        shared_post_id: repostLinkByPostId.get(item.id) || null,
        shared_post: repostLinkByPostId.has(item.id)
          ? sharedPostByPostId.get(repostLinkByPostId.get(item.id)!) ?? null
          : null,
        ...(hiddenIds.has(item.id) ? { profile_hidden: true } : {}),
      }));
    }

    // Calculate hasMore for pagination — from the raw (pre-filter) page size
    const hasMore = rawCount === limit;

    // A viewer-dependent payload (the owner's hidden rows, the per-viewer
    // repost gate, the URL forms): private, never stored.
    return NextResponse.json(
      { items, hasMore, nextOffset: offset + rawCount },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );

  } catch (error) {
    reportRouteError('Error in profile media API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET counts for tab badges
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const supabaseAdmin = getSupabaseAdmin();

    // Get authenticated user (optional)
    const { user } = await getServerAuth(request);
    const viewerId = user?.id || null;

    const { profileId } = await params;
    if (!isUuid(profileId)) {
      return NextResponse.json({ error: 'Invalid profile ID' }, { status: 400 });
    }

    if (!profileId) {
      return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
    }

    // Profile-level privacy gate FIRST — before any RPC. This used to run
    // after the media-counts RPC, so a blocked viewer of a private profile
    // still received real all/stats/tagged badge numbers while the GET
    // endpoint hid the items themselves. Blocked viewers now get zeros.
    let canSee = viewerId === profileId;
    if (!canSee) {
      const { data: prof } = await supabaseAdmin
        .from('profiles')
        .select('visibility')
        .eq('id', profileId)
        .single();
      if (prof?.visibility === 'public') {
        canSee = true;
      } else if (prof) {
        const { canView } = await canViewProfile(profileId, viewerId);
        canSee = canView;
      }
    }
    if (!canSee) {
      return NextResponse.json({
        all: 0, stats: 0, tagged: 0, statements: 0, equipment: 0, vitals: 0, achievements: 0, activities: 0
      });
    }

    // Call count function
    const { data: counts, error: countError } = await supabaseAdmin.rpc('get_profile_media_counts', {
      target_profile_id: profileId,
      viewer_id: viewerId
    });

    if (countError) {
      // Graceful degradation: if the counts RPC is temporarily broken (e.g.
      // migration 022 not yet applied — the RPC referenced posts.game_id which
      // migration 020 dropped), return zero badge counts with 200 instead of a
      // 500. Tab badges show nothing; media itself still loads via the GET RPCs.
      reportRouteError('media counts RPC failed (returning zero counts):', countError.message);
      return NextResponse.json({ all: 0, stats: 0, tagged: 0, statements: 0, achievements: 0, degraded: true });
    }

    const result = counts && counts.length > 0 ? counts[0] : {
      all_media_count: 0,
      stats_media_count: 0,
      tagged_media_count: 0,
      statements_count: 0
    };

    // Equipment, training & achievements counts for their tab badges. The media
    // RPC doesn't cover these tables, so they were always 0. (Visibility
    // already gated above.)
    // Activities (245): "Only me" activities count for the athlete alone; a
    // missing table (pre-245) reads 0 (countActivities never throws).
    const [{ count: eqCount }, { count: vitCount }, { count: achCount }, activities] = await Promise.all([
      supabaseAdmin.from('athlete_equipment').select('id', { count: 'exact', head: true }).eq('profile_id', profileId),
      supabaseAdmin.from('athlete_vitals').select('id', { count: 'exact', head: true }).eq('profile_id', profileId),
      supabaseAdmin.from('athlete_achievements').select('id', { count: 'exact', head: true }).eq('profile_id', profileId),
      countActivities(supabaseAdmin, profileId, viewerId === profileId ? 'owner' : 'viewer'),
    ]);
    const equipment = eqCount ?? 0;
    // Training privacy (migration 122): a master-hidden section must not leak
    // its size through the tab badge — non-owners see 0.
    let bodyMetrics = vitCount ?? 0;
    if (viewerId !== profileId && bodyMetrics > 0) {
      const { data: privRow } = await supabaseAdmin
        .from('profiles')
        .select('vitals_privacy')
        .eq('id', profileId)
        .single();
      if (parseTrainingPrivacy(privRow?.vitals_privacy).hidden) bodyMetrics = 0;
    }
    const achievements = achCount ?? 0;

    return NextResponse.json({
      all: parseInt(result.all_media_count || '0', 10),
      stats: parseInt(result.stats_media_count || '0', 10),
      tagged: parseInt(result.tagged_media_count || '0', 10),
      // Absent until migration 074 runs — || '0' degrades it to zero.
      statements: parseInt(result.statements_count || '0', 10),
      equipment,
      vitals: bodyMetrics, // the payload key never renames (the Training tab count)
      achievements,
      activities
    });

  } catch (error) {
    reportRouteError('Error in profile media counts API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
