import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { reportRouteError } from '@/lib/observability/report';

// The comment-like toggle is ONE call with a GATE (migration 288, the
// leftovers program PR 3, Oct 28 2026): `comment_like_toggle(viewer,
// comment)` requires the parent post to pass the like gate (287 —
// post_like_allowed: the read gate minus blocks) and the comment to be
// published, then removes or inserts the viewer's like and reads back the
// trigger-written count (277's ±1; 190's bell) in one transaction. Before
// 288 this route checked NOTHING about the post and made four round trips.
// The wire shape is unchanged: { isLiked, likes_count }; a refusal is the
// 404 a missing comment answers. The route never counts the rows and never
// writes the column (`counter-writes.test.ts`). `requireAuth({ limit })`
// (286) spends one round trip for write-general + the like bucket.
type CommentLikeOutcome = { outcome: 'not_found' | 'liked' | 'already_liked' | 'unliked'; likes_count?: number };

export async function POST(request: NextRequest) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const body = await request.json();
    const { commentId } = body;

    if (!commentId || !isUuid(commentId)) {
      return NextResponse.json({ error: 'Comment ID is required' }, { status: 400 });
    }

    // The liking profile is ALWAYS the session user.
    const user = await requireAuth(request, { limit: 'like' }); // 286: one round trip for both buckets
    const limited = await enforceRateLimit(request, 'like', { userId: user.id });
    if (limited) return limited;

    const { data, error } = await supabaseAdmin.rpc('comment_like_toggle', { p_viewer: user.id, p_comment_id: commentId });
    if (error) {
      if (error.code === 'PGRST202') {
        // A deploy ahead of migration 288 on this database: say so, cache nothing.
        return NextResponse.json({ error: 'Like service updating' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
      }
      reportRouteError('Error toggling comment like:', error);
      return NextResponse.json({ error: 'Failed to process like request' }, { status: 500 });
    }
    const result = (data ?? { outcome: 'not_found' }) as CommentLikeOutcome;
    const likes_count = result.likes_count ?? 0;

    switch (result.outcome) {
      case 'unliked':
        return NextResponse.json({ isLiked: false, likes_count });
      case 'liked':
      case 'already_liked':
        return NextResponse.json({ isLiked: true, likes_count });
      default:
        return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    }
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('Error processing comment like request:', error);
    return NextResponse.json({ error: 'Failed to process like request' }, { status: 500 });
  }
}
