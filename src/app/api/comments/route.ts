import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAdmin } from '@/lib/auth-server';

// Helper to create Supabase client with SSR cookie support
function createSupabaseServerClient(request: NextRequest) {
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

// GET - Fetch comments for a post
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const postId = searchParams.get('postId');

    if (!postId) {
      return NextResponse.json(
        { error: 'Post ID is required' },
        { status: 400 }
      );
    }

    const supabase = createSupabaseServerClient(request);

    // Fetch comments with profile data and likes
    // Sort: pinned first, then by likes (most liked on top), then chronological
    const { data: comments, error } = await supabase
      .from('post_comments')
      .select(`
        *,
        profile:profiles(
          id,
          first_name,
          middle_name,
          last_name,
          full_name,
          username,
          handle,
          avatar_url
        ),
        comment_likes(profile_id)
      `)
      .eq('post_id', postId)
      .order('is_pinned', { ascending: false, nullsFirst: false })
      .order('likes_count', { ascending: false })
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching comments:', error);
      return NextResponse.json(
        { error: 'Failed to fetch comments' },
        { status: 500 }
      );
    }

    return NextResponse.json({ comments: comments || [] });
  } catch (error) {
    console.error('Error in GET /api/comments:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST - Create a new comment
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { postId, content, parentCommentId, gif_url } = body;

    if (!postId || (!content?.trim() && !gif_url)) {
      return NextResponse.json(
        { error: 'Post ID and content or GIF are required' },
        { status: 400 }
      );
    }

    const supabase = createSupabaseServerClient(request);

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get user's profile to get profile_id
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'Profile not found' },
        { status: 404 }
      );
    }

    // Create comment
    const { data: comment, error: commentError } = await supabase
      .from('post_comments')
      .insert({
        post_id: postId,
        profile_id: profile.id,
        content: content?.trim() || null,
        gif_url: gif_url || null,
        parent_comment_id: parentCommentId || null
      })
      .select(`
        *,
        profile:profiles(
          id,
          first_name,
          middle_name,
          last_name,
          full_name,
          username,
          handle,
          avatar_url
        )
      `)
      .single();

    if (commentError) {
      console.error('Error creating comment:', commentError);
      return NextResponse.json(
        { error: 'Failed to create comment' },
        { status: 500 }
      );
    }

    // Count actual rows and sync cached column
    const admin = getSupabaseAdmin();
    const { count } = await admin
      .from('post_comments')
      .select('id', { count: 'exact', head: true })
      .eq('post_id', postId);

    const trueCount = count ?? 0;
    await admin.from('posts').update({ comments_count: trueCount }).eq('id', postId);

    return NextResponse.json({ comment, commentsCount: trueCount }, { status: 201 });
  } catch (error) {
    console.error('Error in POST /api/comments:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE - Delete a comment
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const commentId = searchParams.get('commentId');

    if (!commentId) {
      return NextResponse.json(
        { error: 'Comment ID is required' },
        { status: 400 }
      );
    }

    const supabase = createSupabaseServerClient(request);

    // Get current user to verify authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get the post_id before deleting so we can update the cached count
    const { data: commentData } = await supabase
      .from('post_comments')
      .select('post_id')
      .eq('id', commentId)
      .single();

    const postId = commentData?.post_id;

    // Delete comment (RLS will ensure user can only delete their own)
    const { error: deleteError } = await supabase
      .from('post_comments')
      .delete()
      .eq('id', commentId);

    if (deleteError) {
      console.error('Error deleting comment:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete comment' },
        { status: 500 }
      );
    }

    // Count actual rows and sync cached column
    let commentsCount = 0;
    if (postId) {
      const admin = getSupabaseAdmin();
      const { count } = await admin
        .from('post_comments')
        .select('id', { count: 'exact', head: true })
        .eq('post_id', postId);

      commentsCount = count ?? 0;
      await admin.from('posts').update({ comments_count: commentsCount }).eq('id', postId);
    }

    return NextResponse.json({ success: true, commentsCount });
  } catch (error) {
    console.error('Error in DELETE /api/comments:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PATCH - Pin or unpin a comment (post owner only)
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { commentId, postId, action } = body;

    if (!commentId || !postId || !['pin', 'unpin'].includes(action)) {
      return NextResponse.json(
        { error: 'commentId, postId, and action (pin/unpin) are required' },
        { status: 400 }
      );
    }

    const supabase = createSupabaseServerClient(request);

    // Verify authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify caller is the post owner
    const admin = getSupabaseAdmin();
    const { data: post } = await admin
      .from('posts')
      .select('profile_id')
      .eq('id', postId)
      .single();

    if (!post || post.profile_id !== user.id) {
      return NextResponse.json({ error: 'Only the post owner can pin comments' }, { status: 403 });
    }

    if (action === 'pin') {
      // Unpin any existing pinned comment for this post first
      await admin
        .from('post_comments')
        .update({ is_pinned: false })
        .eq('post_id', postId)
        .eq('is_pinned', true);

      // Pin the target comment
      const { error: pinError } = await admin
        .from('post_comments')
        .update({ is_pinned: true })
        .eq('id', commentId)
        .eq('post_id', postId);

      if (pinError) {
        console.error('Error pinning comment:', pinError);
        return NextResponse.json({ error: 'Failed to pin comment' }, { status: 500 });
      }
    } else {
      // Unpin the comment
      const { error: unpinError } = await admin
        .from('post_comments')
        .update({ is_pinned: false })
        .eq('id', commentId);

      if (unpinError) {
        console.error('Error unpinning comment:', unpinError);
        return NextResponse.json({ error: 'Failed to unpin comment' }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, action });
  } catch (error) {
    console.error('Error in PATCH /api/comments:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
