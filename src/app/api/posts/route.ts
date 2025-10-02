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
      golfData = null
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
    const postData: any = {
      profile_id: userId,
      sport_key: postType, // Use postType as sport_key for our unified approach
      caption: caption,
      visibility: visibility,
      tags: tags,
      hashtags: hashtags,
      likes_count: 0,
      comments_count: 0
    };

    console.log('[POST] Creating post with tags:', tags);
    console.log('[POST] Creating post with hashtags:', hashtags);

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
            par: golfData.coursePar || 72
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
            par: golfData.coursePar || 72
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
          .filter((hole: any) => hole.score !== undefined)
          .map((hole: any) => ({
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
      const mediaRecords = media.map((file: any, index: number) => ({
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
        profiles (
          id,
          full_name,
          first_name,
          last_name,
          avatar_url
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
    } else {
      // Only show public posts for non-user queries
      query = query.eq('visibility', 'public');
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

    // Fetch golf rounds with hole-by-hole data for posts that have round_id
    const postsWithRounds = await Promise.all(
      (posts || []).map(async (post) => {
        let golfRound = null;

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
              roundData.golf_holes.sort((a: any, b: any) => a.hole_number - b.hole_number);
            }

            golfRound = roundData;
          }
        }

        return { ...post, golf_round: golfRound };
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
          last_name: post.profiles.last_name,
          full_name: post.profiles.full_name,
          avatar_url: post.profiles.avatar_url
        },
        media: (post.post_media || [])
          .sort((a: any, b: any) => a.display_order - b.display_order)
          .map((media: any) => ({
            id: media.id,
            media_url: media.media_url,
            media_type: media.media_type,
            display_order: media.display_order
          })),
          likes: post.post_likes || [],
          golf_round: post.golf_round || null
        };
      });

    return NextResponse.json({ posts: transformedPosts });

  } catch (error) {
    console.error('Posts fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch posts' }, { status: 500 });
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