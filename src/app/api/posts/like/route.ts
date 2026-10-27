import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { reportRouteError } from '@/lib/observability/report';

// The like toggle is ONE call (migration 282, trip-count program PR 3, Oct 27
// 2026): `post_like_toggle(viewer, post)` applies the visibility gate, removes
// or inserts the viewer's like and reads back the trigger-written count, all
// in one transaction — the route maps its outcome onto the wire shape it has
// always had. The TRIGGER adds or subtracts one (277; Convention 32); the
// bell is 190's `notify_post_like`, also a trigger. The route never counts
// the rows and never writes the column (`counter-writes.test.ts`). Before
// 282 this file made the gate's post read, a follow read, the existing-like
// read, the write and the count read as five separate trips.
type LikeToggleOutcome = { outcome: 'not_found' | 'liked' | 'already_liked' | 'unliked'; likes_count?: number };

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

    if (postId && !isUuid(postId)) {
      // Same outcome the lookup produces for a bogus id — deliberately 404,
      // not 400, to keep the wire contract identical.
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }
    if (!postId) {
      return NextResponse.json({ error: 'Post ID is required' }, { status: 400 });
    }

    // Existence + visibility gate, the toggle and the count — one call. Only
    // posts the viewer can actually see may be liked; missing and hidden both
    // answer 404, so valid post ids cannot be probed.
    const { data, error } = await supabase.rpc('post_like_toggle', { p_viewer: user.id, p_post_id: postId });
    if (error) {
      if (error.code === 'PGRST202') {
        // A deploy ahead of migration 282 on this database: say so, cache nothing.
        return NextResponse.json({ error: 'Like service updating' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
      }
      reportRouteError('Error toggling like:', error);
      return NextResponse.json({ error: 'Failed to process like request' }, { status: 500 });
    }
    const result = (data ?? { outcome: 'not_found' }) as LikeToggleOutcome;
    const likesCount = result.likes_count ?? 0;

    switch (result.outcome) {
      case 'unliked':
        return NextResponse.json({ action: 'unliked', message: 'Post unliked successfully', likesCount });
      case 'liked':
        return NextResponse.json({ action: 'liked', message: 'Post liked successfully', likesCount });
      case 'already_liked':
        // A concurrent like got there first; its trigger wrote the column.
        return NextResponse.json({ action: 'liked', message: 'Post already liked', likesCount });
      default:
        return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('Error processing like request:', error);
    return NextResponse.json({ error: 'Failed to process like request' }, { status: 500 });
  }
}
