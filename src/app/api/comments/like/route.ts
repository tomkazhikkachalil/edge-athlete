import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getSupabaseAdmin, getServerAuth } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { reportRouteError } from '@/lib/observability/report';

// The count is RECOUNTED after every toggle (Oct 4 2026 — the post like
// route's pattern): `post_comments.likes_count` used to ride +1/−1 triggers
// alone, and a drifted number was never corrected. Tom: "make sure the count
// is accurate." The triggers stay as defense; this is the truth the caller
// renders. A failed recount keeps the stored number rather than failing the like.
async function recountCommentLikes(admin: ReturnType<typeof getSupabaseAdmin>, commentId: string): Promise<number> {
  const { count, error } = await admin
    .from('comment_likes')
    .select('id', { count: 'exact', head: true })
    .eq('comment_id', commentId);
  if (error || count === null) {
    const { data } = await admin.from('post_comments').select('likes_count').eq('id', commentId).single();
    return data?.likes_count ?? 0;
  }
  await admin.from('post_comments').update({ likes_count: count }).eq('id', commentId);
  return count;
}

export async function POST(request: NextRequest) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const body = await request.json();
    const { commentId } = body;

    if (!commentId || !isUuid(commentId)) {
      return NextResponse.json({ error: 'Comment ID is required' }, { status: 400 });
    }

    // Get authenticated user
    const { user, error: userError } = await getServerAuth(request);

    if (userError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const limited = await enforceRateLimit(request, 'like', { userId: user.id });
    if (limited) return limited;

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
      reportRouteError('Error checking comment like status:', checkError);
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
        reportRouteError('Error unliking comment:', deleteError);
        return NextResponse.json({ error: 'Failed to unlike comment' }, { status: 500 });
      }

      // Get updated count after unlike
      const likesCount = await recountCommentLikes(supabaseAdmin, commentId);


      return NextResponse.json({
        isLiked: false,
        likes_count: likesCount
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
        reportRouteError('Error liking comment:', insertError);

        // Handle unique constraint violation (23505 is PostgreSQL's duplicate key error)
        if (insertError.code === '23505' || insertError.message?.includes('duplicate')) {
          // User already liked this comment (race condition), get current count
          const likesCount = await recountCommentLikes(supabaseAdmin, commentId);
          return NextResponse.json({ isLiked: true, likes_count: likesCount });
        }

        return NextResponse.json({ error: 'Failed to like comment' }, { status: 500 });
      }

      // Get updated count after like
      const likesCount = await recountCommentLikes(supabaseAdmin, commentId);


      return NextResponse.json({
        isLiked: true,
        likes_count: likesCount
      });
    }

  } catch (error) {
    reportRouteError('Error processing comment like request:', error);
    return NextResponse.json({ error: 'Failed to process like request' }, { status: 500 });
  }
}
