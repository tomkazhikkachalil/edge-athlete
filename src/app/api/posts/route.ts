import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth-server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: NextRequest) {
  try {
    // Require authentication
    const user = await requireAuth(request);

    const body = await request.json();
    const {
      postType = 'general', // 'general' or 'golf'
      caption = '',
      tags = [],
      hashtags = [],
      visibility = 'public',
      media = [],
      golfData = null,
      taggedProfiles = [] // Array of profile IDs to tag in this post
    } = body;

    // Use authenticated user's ID
    const userId = user.id;
    console.log('[POST] Creating post for authenticated user:', userId);

    // Validate post type
    if (!['general', 'golf'].includes(postType)) {
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
      golf_mode?: string;
    } = {
      profile_id: userId,
      sport_key: postType, // Use postType as sport_key for our unified approach
      caption: caption,
      visibility: visibility,
      tags: taggedProfiles, // Store tagged people IDs (not category tags)
      hashtags: hashtags,
      likes_count: 0,
      comments_count: 0
    };

    console.log('[POST] Creating post with tagged profile IDs:', taggedProfiles);
    console.log('[POST] Creating post with hashtags:', hashtags);
    console.log('[POST] Category tags (not stored):', tags);

    let roundId: string | null = null;

    // Create golf entities if provided (comprehensive scorecard)
    if (postType === 'golf' && golfData) {
      // Check for existing round on same date/course
      const { data: existingRounds } = await supabase
        .from('golf_rounds')
        .select('id')
        .eq('profile_id', userId)
        .eq('date', golfData.date)
        .eq('course', golfData.courseName)
        .limit(1);

      if (existingRounds && existingRounds.length > 0) {
        // Use existing round
        roundId = existingRounds[0].id;

        // Update existing round with comprehensive data
        await supabase
          .from('golf_rounds')
          .update({
            course_location: golfData.courseLocation || null,
            tee: golfData.teeBox || null,
            holes: parseInt(golfData.holes) || 18,
            par: golfData.coursePar || 72,
            weather: golfData.weather || null,
            temperature: golfData.temperature || null,
            wind: golfData.wind || null,
            course_rating: golfData.courseRating || null,
            slope_rating: golfData.courseSlope || null
          })
          .eq('id', roundId);
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
            par: golfData.coursePar || 72,
            weather: golfData.weather || null,
            temperature: golfData.temperature || null,
            wind: golfData.wind || null,
            course_rating: golfData.courseRating || null,
            slope_rating: golfData.courseSlope || null
          })
          .select()
          .single();

        if (roundError) {
          console.error('Round creation error:', roundError);
        } else {
          roundId = newRound.id;
        }
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
          }

          // Calculate round stats
          try {
            await supabase.rpc('calculate_round_stats', { round_uuid: roundId });
          } catch (statsError) {
            console.error('Stats calculation error:', statsError);
          }
        }
      }

      // Add golf references to post
      if (roundId) {
        postData.round_id = roundId;
        postData.golf_mode = 'round_recap';
        console.log('[POST] Adding round_id to post:', roundId);
      }
    }

    console.log('[POST] Final postData before insert:', JSON.stringify(postData, null, 2));

    const { data: post, error: postError } = await supabase
      .from('posts')
      .insert(postData)
      .select()
      .single();

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

    console.log('[POST] Post created successfully with ID:', post.id);
    console.log('[POST] Post round_id:', post.round_id);

    // Add media files if provided
    if (media && media.length > 0) {
      const mediaRecords = media.map((file: { url: string; type: string; sortOrder?: number; thumbnailUrl?: string }, index: number) => ({
        post_id: post.id,
        media_url: file.url,
        media_type: file.type,
        display_order: file.sortOrder || index + 1,
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

    return NextResponse.json({
      success: true,
      post: post,
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
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const sportKey = searchParams.get('sportKey');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Get current authenticated user (for privacy checks)
    let currentUserId: string | null = null;
    try {
      const user = await requireAuth(request);
      currentUserId = user.id;
    } catch {
      // Not authenticated - will only see public content
      currentUserId = null;
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
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Filter by user if provided
    if (userId) {
      query = query.eq('profile_id', userId);
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

    console.log(`[PRIVACY] Total posts fetched: ${posts?.length || 0}, Visible after filtering: ${finalVisiblePosts.length}`);

    // Fetch golf rounds with hole-by-hole data for posts that have round_id
    // AND fetch tagged profiles for posts with tags
    const postsWithRounds = await Promise.all(
      finalVisiblePosts.map(async (post) => {
        let golfRound = null;
        let taggedProfiles: any[] = [];

        if (post.round_id) {
          console.log('[GET] Fetching golf round for post:', post.id, 'round_id:', post.round_id);

          const { data: roundData, error: roundError } = await supabase
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

          if (roundError) {
            console.error('[GET] Error fetching golf round:', roundError);
          } else {
            console.log('[GET] Golf round fetched:', roundData?.id, 'holes count:', roundData?.golf_holes?.length);

            if (roundData && roundData.golf_holes) {
              // Sort holes by hole number
              roundData.golf_holes.sort((a: { hole_number: number }, b: { hole_number: number }) => a.hole_number - b.hole_number);
            }

            golfRound = roundData;
          }
        }

        // Fetch tagged profiles if post has tags
        if (post.tags && post.tags.length > 0) {
          console.log('[GET] Fetching tagged profiles for post:', post.id, 'tags:', post.tags);

          const { data: profiles, error: profilesError } = await supabase
            .from('profiles')
            .select('id, first_name, middle_name, last_name, full_name, avatar_url, handle')
            .in('id', post.tags);

          if (profilesError) {
            console.error('[GET] Error fetching tagged profiles:', profilesError);
          } else if (profiles) {
            taggedProfiles = profiles;
            console.log('[GET] Tagged profiles fetched:', profiles.length);
          }
        }

        return { ...post, golf_round: golfRound, tagged_profiles: taggedProfiles };
      })
    );

    // Transform the data to match the expected format
    const transformedPosts = postsWithRounds
      .filter(post => post.profiles) // Filter out posts without profiles
      .map(post => {
        console.log('[GET] Post tags from DB:', post.id, post.tags);
        console.log('[GET] Post hashtags from DB:', post.id, post.hashtags);
        return {
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
          profile: {
          id: post.profiles.id,
          first_name: post.profiles.first_name,
          middle_name: post.profiles.middle_name,
          last_name: post.profiles.last_name,
          full_name: post.profiles.full_name,
          avatar_url: post.profiles.avatar_url
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
          tagged_profiles: post.tagged_profiles || []
        };
      });

    return NextResponse.json({ posts: transformedPosts });

  } catch (error) {
    console.error('Posts fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch posts' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Require authentication
    const user = await requireAuth(request);

    const body = await request.json();
    const {
      postId,
      caption = '',
      taggedProfiles = [],
      hashtags = [],
      visibility = 'public'
    } = body;

    if (!postId) {
      return NextResponse.json({ error: 'Post ID is required' }, { status: 400 });
    }

    console.log('[PUT] Updating post:', postId, 'for user:', user.id);

    // Validate visibility
    if (!['public', 'private'].includes(visibility)) {
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
        visibility: visibility,
        tags: taggedProfiles, // Store tagged people IDs (not category tags)
        hashtags: hashtags,
        updated_at: new Date().toISOString()
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

    console.log('[PUT] Post updated successfully:', postId);

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