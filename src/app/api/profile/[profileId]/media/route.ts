import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

// Helper function for cookie authentication
function createSupabaseClient(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          const cookieHeader = request.headers.get('cookie');
          if (!cookieHeader) return undefined;
          const cookies = Object.fromEntries(
            cookieHeader.split('; ').map(cookie => {
              const [key, value] = cookie.split('=');
              return [key, decodeURIComponent(value)];
            })
          );
          return cookies[name];
        },
      },
    }
  );
}

// Admin client for calling database functions
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

interface MediaItem {
  id: string;
  caption: string | null;
  sport_key: string | null;
  stats_data: Record<string, unknown> | null;
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

export async function GET(
  request: NextRequest,
  { params }: { params: { profileId: string } }
) {
  try {
    const supabase = createSupabaseClient(request);
    const { searchParams } = new URL(request.url);

    // Get authenticated user (optional - public profiles work without auth)
    const { data: { user } } = await supabase.auth.getUser();
    const viewerId = user?.id || null;

    // Parameters
    const { profileId } = params;
    const tab = searchParams.get('tab') || 'all'; // all | stats | tagged
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const sort = searchParams.get('sort') || 'newest'; // newest | most_engaged
    const mediaType = searchParams.get('mediaType') || 'all'; // all | photos | videos | posts

    if (!profileId) {
      return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
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

    // Call database function
    const { data: mediaItems, error: mediaError } = await supabaseAdmin.rpc(functionName, {
      target_profile_id: profileId,
      viewer_id: viewerId,
      media_limit: limit,
      media_offset: offset
    });

    if (mediaError) {
      console.error(`Error fetching ${tab} media:`, mediaError);
      return NextResponse.json({ error: 'Failed to fetch media' }, { status: 500 });
    }

    let items = mediaItems as MediaItem[] || [];

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

    // Fetch media attachments for each post
    if (items.length > 0) {
      const postIds = items.map((item: MediaItem) => item.id);
      const { data: media } = await supabase
        .from('post_media')
        .select('id, post_id, media_url, media_type, display_order')
        .in('post_id', postIds)
        .order('display_order', { ascending: true });

      // Attach media to posts
      const mediaMap = new Map<string, typeof media>();
      if (media) {
        media.forEach((m: { post_id: string }) => {
          if (!mediaMap.has(m.post_id)) {
            mediaMap.set(m.post_id, []);
          }
          mediaMap.get(m.post_id)!.push(m);
        });
      }

      items = items.map((item: MediaItem) => ({
        ...item,
        media: mediaMap.get(item.id) || []
      }));
    }

    // Calculate hasMore for pagination
    const hasMore = items.length === limit;

    return NextResponse.json({
      items,
      hasMore,
      nextOffset: offset + items.length
    });

  } catch (error) {
    console.error('Error in profile media API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET counts for tab badges
export async function POST(
  request: NextRequest,
  { params }: { params: { profileId: string } }
) {
  try {
    const supabase = createSupabaseClient(request);

    // Get authenticated user (optional)
    const { data: { user } } = await supabase.auth.getUser();
    const viewerId = user?.id || null;

    const { profileId } = params;

    if (!profileId) {
      return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
    }

    // Call count function
    const { data: counts, error: countError } = await supabaseAdmin.rpc('get_profile_media_counts', {
      target_profile_id: profileId,
      viewer_id: viewerId
    });

    if (countError) {
      console.error('Error fetching media counts:', countError);
      return NextResponse.json({ error: 'Failed to fetch counts' }, { status: 500 });
    }

    const result = counts && counts.length > 0 ? counts[0] : {
      all_media_count: 0,
      stats_media_count: 0,
      tagged_media_count: 0
    };

    return NextResponse.json({
      all: parseInt(result.all_media_count || '0', 10),
      stats: parseInt(result.stats_media_count || '0', 10),
      tagged: parseInt(result.tagged_media_count || '0', 10)
    });

  } catch (error) {
    console.error('Error in profile media counts API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
