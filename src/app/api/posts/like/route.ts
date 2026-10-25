import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { reportRouteError } from '@/lib/observability/report';

// The TRIGGER recounts; the route READS (scale fix 4, Oct 25 2026 —
// docs/SCALE_AUDIT.md hole 4, Convention 32 amended). 015's
// `trigger_update_post_likes_count` recounts `posts.likes_count` inside the
// same statement as the like's insert or delete, so by the time the route's
// write returns the column is already the truth. The route used to COUNT the
// likes again and UPDATE the column a second time — two counts and two
// `posts` writes per like, the second pair pure cost (the O(likes) count
// twice on a popular post). One indexed read now.
async function readLikesCount(admin: ReturnType<typeof getSupabaseAdmin>, postId: string): Promise<number> {
  const { data } = await admin.from('posts').select('likes_count').eq('id', postId).maybeSingle();
  return data?.likes_count ?? 0;
}

export async function POST(request: NextRequest) {
  try {
    // The liking profile is ALWAYS the session user — never a body-supplied
    // profileId (that let anyone forge/remove likes as any user).
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'like', { userId: user.id });
    if (limited) return limited;

    const supabase = getSupabaseAdmin();
    const body = await request.json();
    const { postId } = body;
    const profileId = user.id;

    if (postId && !isUuid(postId)) {
      // Same outcome the maybeSingle lookup produces for a bogus id today —
      // deliberately 404, not 400, to keep the wire contract identical.
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }
    if (!postId) {
      return NextResponse.json({ error: 'Post ID is required' }, { status: 400 });
    }

    // Existence + visibility gate (admin client bypasses RLS): only posts
    // the viewer can actually see may be liked. Also prevents probing for
    // valid post UUIDs (missing/hidden both return 404, and bogus IDs no
    // longer surface as FK-violation 500s).
    const { data: targetPost } = await supabase
      .from('posts')
      .select('id, profile_id, visibility, profiles:profile_id (visibility)')
      .eq('id', postId)
      .maybeSingle();

    if (!targetPost) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    const postOwner = (Array.isArray(targetPost.profiles) ? targetPost.profiles[0] : targetPost.profiles) as { visibility?: string } | null;
    const publiclyVisible = targetPost.visibility === 'public' && postOwner?.visibility === 'public';
    if (targetPost.profile_id !== profileId && !publiclyVisible) {
      const { data: follow } = await supabase
        .from('follows')
        .select('id')
        .eq('follower_id', profileId)
        .eq('following_id', targetPost.profile_id)
        .eq('status', 'accepted')
        .maybeSingle();
      if (!follow) {
        return NextResponse.json({ error: 'Post not found' }, { status: 404 });
      }
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
      reportRouteError('Error checking like status:', checkError);
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
        reportRouteError('Error unliking post:', deleteError);
        return NextResponse.json({ error: 'Failed to unlike post' }, { status: 500 });
      }

      // The delete's trigger recounted the column; read it.
      const trueCount = await readLikesCount(supabase, postId);

      return NextResponse.json({
        action: 'unliked',
        message: 'Post unliked successfully',
        likesCount: trueCount
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
        reportRouteError('Error liking post:', insertError);

        // Handle unique constraint violation (23505 is PostgreSQL's duplicate key error)
        if (insertError.code === '23505' || insertError.message?.includes('duplicate')) {
          // User already liked this post (race condition): the other
          // request's trigger wrote the column — read it.
          return NextResponse.json({
            action: 'liked',
            message: 'Post already liked',
            likesCount: await readLikesCount(supabase, postId)
          });
        }

        return NextResponse.json({ error: 'Failed to like post' }, { status: 500 });
      }

      // The insert's trigger recounted the column; read it.
      const trueCount = await readLikesCount(supabase, postId);

      return NextResponse.json({
        action: 'liked',
        message: 'Post liked successfully',
        likesCount: trueCount
      });
    }

  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('Error processing like request:', error);
    return NextResponse.json({ error: 'Failed to process like request' }, { status: 500 });
  }
}