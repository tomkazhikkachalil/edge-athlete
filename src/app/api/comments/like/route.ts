import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Helper to create Supabase client with auth
function createSupabaseClient(request: NextRequest) {
  return createServerClient(
    supabaseUrl,
    supabaseAnonKey,
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { commentId } = body;

    if (!commentId) {
      return NextResponse.json({ error: 'Comment ID is required' }, { status: 400 });
    }

    // Get authenticated user
    const supabase = createSupabaseClient(request);
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const profileId = user.id;

    // Check if the user already liked this comment (use admin client for reliable check)
    const { data: existingLike, error: checkError } = await supabaseAdmin
      .from('comment_likes')
      .select('id')
      .eq('comment_id', commentId)
      .eq('profile_id', profileId)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      // PGRST116 means no rows found, which is expected if not liked yet
      console.error('Error checking comment like status:', checkError);
      return NextResponse.json({ error: 'Failed to check like status' }, { status: 500 });
    }

    if (existingLike) {
      // Unlike: Remove the like
      const { error: deleteError } = await supabaseAdmin
        .from('comment_likes')
        .delete()
        .eq('comment_id', commentId)
        .eq('profile_id', profileId);

      if (deleteError) {
        console.error('Error unliking comment:', deleteError);
        return NextResponse.json({ error: 'Failed to unlike comment' }, { status: 500 });
      }

      // Get updated count after unlike
      const { data: comment } = await supabaseAdmin
        .from('post_comments')
        .select('likes_count')
        .eq('id', commentId)
        .single();

      console.log(`[COMMENT LIKE API] User ${profileId} unliked comment ${commentId}. New count: ${comment?.likes_count}`);

      return NextResponse.json({
        isLiked: false,
        likes_count: comment?.likes_count ?? 0
      });
    } else {
      // Like: Add the like
      const { error: insertError } = await supabaseAdmin
        .from('comment_likes')
        .insert({
          comment_id: commentId,
          profile_id: profileId
        });

      if (insertError) {
        console.error('Error liking comment:', insertError);

        // Handle unique constraint violation (23505 is PostgreSQL's duplicate key error)
        if (insertError.code === '23505' || insertError.message?.includes('duplicate')) {
          // User already liked this comment (race condition), get current count
          const { data: comment } = await supabaseAdmin
            .from('post_comments')
            .select('likes_count')
            .eq('id', commentId)
            .single();

          return NextResponse.json({
            isLiked: true,
            likes_count: comment?.likes_count ?? 0
          });
        }

        return NextResponse.json({ error: 'Failed to like comment' }, { status: 500 });
      }

      // Get updated count after like
      const { data: comment } = await supabaseAdmin
        .from('post_comments')
        .select('likes_count')
        .eq('id', commentId)
        .single();

      console.log(`[COMMENT LIKE API] User ${profileId} liked comment ${commentId}. New count: ${comment?.likes_count}`);

      return NextResponse.json({
        isLiked: true,
        likes_count: comment?.likes_count ?? 0
      });
    }

  } catch (error) {
    console.error('Error processing comment like request:', error);
    return NextResponse.json({ error: 'Failed to process like request' }, { status: 500 });
  }
}
