import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { postId, profileId } = body;

    if (!postId || !profileId) {
      return NextResponse.json({ error: 'Post ID and Profile ID are required' }, { status: 400 });
    }

    // Check if the user already liked this post
    const { data: existingLike, error: checkError } = await supabase
      .from('post_likes')
      .select('id')
      .eq('post_id', postId)
      .eq('profile_id', profileId)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      // PGRST116 means no rows found, which is expected if not liked yet
      console.error('Error checking like status:', checkError);
      return NextResponse.json({ error: 'Failed to check like status' }, { status: 500 });
    }

    if (existingLike) {
      // Unlike: Remove the like
      const { error: deleteError } = await supabase
        .from('post_likes')
        .delete()
        .eq('post_id', postId)
        .eq('profile_id', profileId);

      if (deleteError) {
        console.error('Error unliking post:', deleteError);
        return NextResponse.json({ error: 'Failed to unlike post' }, { status: 500 });
      }

      // Get updated count after unlike
      const { data: post } = await supabase
        .from('posts')
        .select('likes_count')
        .eq('id', postId)
        .single();

      console.log(`[LIKE API] User ${profileId} unliked post ${postId}. New count: ${post?.likes_count}`);

      return NextResponse.json({
        action: 'unliked',
        message: 'Post unliked successfully',
        likesCount: post?.likes_count ?? 0
      });
    } else {
      // Like: Add the like
      const { error: insertError } = await supabase
        .from('post_likes')
        .insert({
          post_id: postId,
          profile_id: profileId
        });

      if (insertError) {
        console.error('Error liking post:', insertError);

        // Handle unique constraint violation (23505 is PostgreSQL's duplicate key error)
        if (insertError.code === '23505' || insertError.message?.includes('duplicate')) {
          // User already liked this post (race condition), get current count
          const { data: post } = await supabase
            .from('posts')
            .select('likes_count')
            .eq('id', postId)
            .single();

          return NextResponse.json({
            action: 'liked',
            message: 'Post already liked',
            likesCount: post?.likes_count ?? 0
          });
        }

        return NextResponse.json({ error: 'Failed to like post' }, { status: 500 });
      }

      // Get updated count after like
      const { data: post } = await supabase
        .from('posts')
        .select('likes_count')
        .eq('id', postId)
        .single();

      console.log(`[LIKE API] User ${profileId} liked post ${postId}. New count: ${post?.likes_count}`);

      return NextResponse.json({
        action: 'liked',
        message: 'Post liked successfully',
        likesCount: post?.likes_count ?? 0
      });
    }

  } catch (error) {
    console.error('Error processing like request:', error);
    return NextResponse.json({ error: 'Failed to process like request' }, { status: 500 });
  }
}