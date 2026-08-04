import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth } from '@/lib/auth-server';

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const { supabase, user, error: authError } = await getServerAuth(request);

    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const { postId } = body;

    if (!postId) {
      return NextResponse.json({ error: 'Post ID is required' }, { status: 400 });
    }

    // Check if the user already saved this post
    const { data: existingSave, error: checkError } = await supabase
      .from('saved_posts')
      .select('id')
      .eq('post_id', postId)
      .eq('profile_id', user.id)
      .maybeSingle();

    if (checkError) {
      console.error('Error checking save status:', checkError);
      return NextResponse.json({ error: 'Failed to check save status' }, { status: 500 });
    }

    if (existingSave) {
      // Unsave: Remove the save
      const { error: deleteError } = await supabase
        .from('saved_posts')
        .delete()
        .eq('post_id', postId)
        .eq('profile_id', user.id);

      if (deleteError) {
        console.error('Error unsaving post:', deleteError);
        return NextResponse.json({ error: 'Failed to unsave post' }, { status: 500 });
      }

      // Get updated count after unsave
      const { data: post } = await supabase
        .from('posts')
        .select('saves_count')
        .eq('id', postId)
        .single();

      return NextResponse.json({
        action: 'unsaved',
        message: 'Post unsaved successfully',
        savesCount: post?.saves_count ?? 0,
        isSaved: false
      });
    } else {
      // Save: Add the save
      const { error: insertError } = await supabase
        .from('saved_posts')
        .insert({
          post_id: postId,
          profile_id: user.id
        });

      if (insertError) {
        console.error('Error saving post:', insertError);

        // Handle unique constraint violation (duplicate save)
        if (insertError.code === '23505' || insertError.message?.includes('duplicate')) {
          const { data: post } = await supabase
            .from('posts')
            .select('saves_count')
            .eq('id', postId)
            .single();

          return NextResponse.json({
            action: 'saved',
            message: 'Post already saved',
            savesCount: post?.saves_count ?? 0,
            isSaved: true
          });
        }

        return NextResponse.json({ error: 'Failed to save post' }, { status: 500 });
      }

      // Get updated count after save
      const { data: post } = await supabase
        .from('posts')
        .select('saves_count')
        .eq('id', postId)
        .single();

      return NextResponse.json({
        action: 'saved',
        message: 'Post saved successfully',
        savesCount: post?.saves_count ?? 0,
        isSaved: true
      });
    }

  } catch (error) {
    console.error('Error processing save request:', error);
    return NextResponse.json({ error: 'Failed to process save request' }, { status: 500 });
  }
}
