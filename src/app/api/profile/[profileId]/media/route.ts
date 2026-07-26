import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, getServerClient } from '@/lib/auth-server';
import { canViewProfile } from '@/lib/privacy';

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
}

interface MediaAttachment {
  id: string;
  post_id: string;
  media_url: string;
  media_type: string;
  display_order: number;
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
  course_rating: number | null;
  slope_rating: number | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const supabase = getServerClient(request);
    const { searchParams } = new URL(request.url);

    // Get authenticated user (optional - public profiles work without auth)
    const { data: { user } } = await supabase.auth.getUser();
    const viewerId = user?.id || null;

    // Parameters (await params in Next.js 15)
    const { profileId } = await params;
    const tab = searchParams.get('tab') || 'all'; // all | stats | tagged
    // NaN-guard (?limit=abc used to reach the RPC and 500)
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10) || 20, 1), 100);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);
    const sort = searchParams.get('sort') || 'newest'; // newest | most_engaged
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
    if (viewerId !== profileId) {
      const { data: targetProfile } = await supabaseAdmin
        .from('profiles')
        .select('visibility')
        .eq('id', profileId)
        .single();
      if (!targetProfile) {
        return NextResponse.json({ items: [], hasMore: false });
      }
      if (targetProfile.visibility !== 'public') {
        const { canView } = await canViewProfile(profileId, viewerId);
        if (!canView) {
          return NextResponse.json({ items: [], hasMore: false });
        }
      }
    }

    // Validate tab
    if (!['all', 'stats', 'tagged'].includes(tab)) {
      return NextResponse.json({ error: 'Invalid tab. Use: all, stats, or tagged' }, { status: 400 });
    }

    // Select appropriate database function based on tab
    let functionName = 'get_profile_all_media';
    if (tab === 'stats') {
      functionName = 'get_profile_stats_media';
    } else if (tab === 'tagged') {
      functionName = 'get_profile_tagged_media';
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
      console.error(`Error fetching ${tab} media:`, mediaError);
      console.error('Function called:', functionName);
      console.error('Filter params present:', {
        sportKeys: !!rpcParams.filter_sport_keys,
        years: !!rpcParams.filter_years,
      });
      if (rpcParams.filter_sport_keys || rpcParams.filter_years) {
        console.error('Hint: ensure migration 018_profile_media_sport_year_filters.sql is applied in Supabase.');
      }
      return NextResponse.json({
        error: 'Failed to fetch media',
        details: mediaError.message,
        hint: mediaError.hint,
        function: functionName
      }, { status: 500 });
    }

    let items = mediaItems as MediaItem[] || [];
    // Pagination must be computed from the RAW page (pre-filter): the media-
    // type filter shrinks the page, and using the filtered count made
    // hasMore false too early and nextOffset re-read consumed rows
    // (duplicate tiles + duplicate React keys under Photos/Videos filters).
    const rawCount = items.length;

    // Client-side filtering for media type
    if (mediaType !== 'all' && items.length > 0) {
      // Fetch media details for filtering
      const postIds = items.map((item: MediaItem) => item.id);
      const { data: mediaDetails } = await supabase
        .from('post_media')
        .select('post_id, media_type')
        .in('post_id', postIds);

      if (mediaDetails) {
        // Create a map of post_id -> has video/photo
        const postMediaMap = new Map<string, { hasVideo: boolean; hasPhoto: boolean }>();
        mediaDetails.forEach((media: { post_id: string; media_type: string }) => {
          if (!postMediaMap.has(media.post_id)) {
            postMediaMap.set(media.post_id, { hasVideo: false, hasPhoto: false });
          }
          const entry = postMediaMap.get(media.post_id)!;
          if (media.media_type === 'video') entry.hasVideo = true;
          if (media.media_type === 'image') entry.hasPhoto = true;
        });

        // Filter based on mediaType
        items = items.filter((item: MediaItem) => {
          const mediaInfo = postMediaMap.get(item.id);
          if (!mediaInfo && mediaType !== 'posts') return false; // Text posts only match 'posts' filter

          if (mediaType === 'photos') {
            return mediaInfo?.hasPhoto || false;
          } else if (mediaType === 'videos') {
            return mediaInfo?.hasVideo || false;
          } else if (mediaType === 'posts') {
            // Include all posts (with or without media)
            return true;
          }
          return true;
        });
      }
    }

    // Apply sorting
    if (sort === 'most_engaged') {
      items.sort((a: MediaItem, b: MediaItem) => {
        const engagementA = (a.likes_count || 0) + (a.comments_count || 0) + (a.saves_count || 0);
        const engagementB = (b.likes_count || 0) + (b.comments_count || 0) + (b.saves_count || 0);
        return engagementB - engagementA;
      });
    }
    // 'newest' is already sorted by created_at DESC in SQL

    // Fetch media attachments and tagged profiles for each post
    if (items.length > 0) {
      const postIds = items.map((item: MediaItem) => item.id);

      // Fetch media attachments
      const { data: media } = await supabase
        .from('post_media')
        .select('id, post_id, media_url, media_type, display_order')
        .in('post_id', postIds)
        .order('display_order', { ascending: true });

      // Attach media to posts
      const mediaMap = new Map<string, MediaAttachment[]>();
      if (media) {
        media.forEach((m: MediaAttachment) => {
          if (!mediaMap.has(m.post_id)) {
            mediaMap.set(m.post_id, []);
          }
          mediaMap.get(m.post_id)!.push(m);
        });
      }

      // Fetch tagged profiles for posts that have tags
      const taggedProfilesMap = new Map<string, TaggedProfile[]>();

      // Collect all unique profile IDs from tags
      const allTagIds = new Set<string>();
      items.forEach((item: MediaItem) => {
        if (item.tags && item.tags.length > 0) {
          item.tags.forEach(tagId => allTagIds.add(tagId));
        }
      });

      // Fetch all tagged profiles in one query if there are any tags
      if (allTagIds.size > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, first_name, middle_name, last_name, full_name, avatar_url, handle')
          .in('id', Array.from(allTagIds));

        // Create a map of profile ID -> profile data
        const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);

        // Build tagged profiles map for each post
        items.forEach((item: MediaItem) => {
          if (item.tags && item.tags.length > 0) {
            const taggedProfiles = item.tags
              .map(tagId => profileMap.get(tagId))
              .filter((profile): profile is TaggedProfile => profile !== undefined); // Remove any undefined profiles
            taggedProfilesMap.set(item.id, taggedProfiles);
          }
        });
      }

      // Fetch golf round data for posts with round_id
      const roundIds = items
        .filter((item: MediaItem) => item.round_id)
        .map((item: MediaItem) => item.round_id as string);

      const golfRoundsMap = new Map<string, GolfRound>();

      if (roundIds.length > 0) {
        const { data: golfRounds, error: roundsError } = await supabaseAdmin
          .from('golf_rounds')
          .select('*')
          .in('id', roundIds);

        if (roundsError) {
          console.error('[PROFILE MEDIA API] Error fetching golf rounds:', roundsError);
        } else {
        }

        if (golfRounds) {
          golfRounds.forEach((round: GolfRound) => {
            golfRoundsMap.set(round.id, round);
          });
        }
      }

      items = items.map((item: MediaItem) => ({
        ...item,
        media: mediaMap.get(item.id) || [],
        tagged_profiles: taggedProfilesMap.get(item.id) || [],
        golf_round: item.round_id ? golfRoundsMap.get(item.round_id) || null : null
      }));
    }

    // Calculate hasMore for pagination — from the raw (pre-filter) page size
    const hasMore = rawCount === limit;

    return NextResponse.json({
      items,
      hasMore,
      nextOffset: offset + rawCount
    });

  } catch (error) {
    console.error('Error in profile media API:', error);
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
    const supabase = getServerClient(request);

    // Get authenticated user (optional)
    const { data: { user } } = await supabase.auth.getUser();
    const viewerId = user?.id || null;

    const { profileId } = await params;

    if (!profileId) {
      return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
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
      console.error('media counts RPC failed (returning zero counts):', countError.message);
      return NextResponse.json({ all: 0, stats: 0, tagged: 0, achievements: 0, degraded: true });
    }

    const result = counts && counts.length > 0 ? counts[0] : {
      all_media_count: 0,
      stats_media_count: 0,
      tagged_media_count: 0
    };

    // Equipment, vitals & achievements counts for their tab badges. The media
    // RPC doesn't cover these tables, so they were always 0. Gate on profile
    // visibility for non-owners (private profiles shouldn't expose these counts).
    let equipment = 0;
    let vitals = 0;
    let achievements = 0;
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
    if (canSee) {
      const [{ count: eqCount }, { count: vitCount }, { count: achCount }] = await Promise.all([
        supabaseAdmin.from('athlete_equipment').select('id', { count: 'exact', head: true }).eq('profile_id', profileId),
        supabaseAdmin.from('athlete_vitals').select('id', { count: 'exact', head: true }).eq('profile_id', profileId),
        supabaseAdmin.from('athlete_achievements').select('id', { count: 'exact', head: true }).eq('profile_id', profileId),
      ]);
      equipment = eqCount ?? 0;
      vitals = vitCount ?? 0;
      achievements = achCount ?? 0;
    }

    return NextResponse.json({
      all: parseInt(result.all_media_count || '0', 10),
      stats: parseInt(result.stats_media_count || '0', 10),
      tagged: parseInt(result.tagged_media_count || '0', 10),
      equipment,
      vitals,
      achievements
    });

  } catch (error) {
    console.error('Error in profile media counts API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
