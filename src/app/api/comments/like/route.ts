import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { commentId, profileId } = body;

    if (!commentId || !profileId) {
      return NextResponse.json({ error: 'Comment ID and Profile ID are required' }, { status: 400 });
    }

    // Check if the user already liked this comment
    const { data: existingLike, error: checkError } = await supabase
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
      const { error: deleteError } = await supabase
        .from('comment_likes')
        .delete()
        .eq('comment_id', commentId)
        .eq('profile_id', profileId);

      if (deleteError) {
        console.error('Error unliking comment:', deleteError);
        return NextResponse.json({ error: 'Failed to unlike comment' }, { status: 500 });
      }

      // Get updated count after unlike
      const { data: comment } = await supabase
        .from('post_comments')
        .select('likes_count')
        .eq('id', commentId)
        .single();

      console.log(`[COMMENT LIKE API] User ${profileId} unliked comment ${commentId}. New count: ${comment?.likes_count}`);

      return NextResponse.json({
        action: 'unliked',
        message: 'Comment unliked successfully',
        likesCount: comment?.likes_count ?? 0
      });
    } else {
      // Like: Add the like
      const { error: insertError } = await supabase
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
          const { data: comment } = await supabase
            .from('post_comments')
            .select('likes_count')
            .eq('id', commentId)
            .single();

          return NextResponse.json({
            action: 'liked',
            message: 'Comment already liked',
            likesCount: comment?.likes_count ?? 0
          });
        }

        return NextResponse.json({ error: 'Failed to like comment' }, { status: 500 });
      }

      // Get updated count after like
      const { data: comment } = await supabase
        .from('post_comments')
        .select('likes_count')
        .eq('id', commentId)
        .single();

      console.log(`[COMMENT LIKE API] User ${profileId} liked comment ${commentId}. New count: ${comment?.likes_count}`);

      return NextResponse.json({
        action: 'liked',
        message: 'Comment liked successfully',
        likesCount: comment?.likes_count ?? 0
      });
    }

  } catch (error) {
    console.error('Error processing comment like request:', error);
    return NextResponse.json({ error: 'Failed to process like request' }, { status: 500 });
  }
}
