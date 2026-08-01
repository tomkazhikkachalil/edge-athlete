import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/lib/auth-server';
import { GROUP_SCORECARD_SELECT, transformGroupPostToScorecard } from '@/lib/golf/scorecard-transform';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/group-posts/[id]/scorecard
 *
 * The full scorecard for a round, keyed on the GROUP POST id — what
 * /live/[groupPostId] needs to render the leaderboard and the scorer.
 *
 * Why not the existing GET /api/group-posts/[id]: that select returns the post,
 * creator, participants and media but no golf_scorecard_data and no
 * golf_participant_scores, so it has neither the hole data nor the scores.
 * Widening it would change the shape for its current callers.
 *
 * Why not GET /api/posts?postId=: that keys on the FEED post id, and the whole
 * point of the round screen is that it works from the group post id even when
 * post_id is null (the backfill is best-effort).
 *
 * Access control is RLS via the user-scoped client — the same select the feed
 * branch already runs. A stranger reading a public round gets it; a private
 * round they are not in returns nothing.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getServerClient(request);

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Round not found' }, { status: 404 });
    }

    const { data, error } = await supabase
      .from('group_posts')
      .select(GROUP_SCORECARD_SELECT)
      .eq('id', id)
      .maybeSingle();

    // RLS denial and a genuinely missing row are indistinguishable here, and
    // that is deliberate — neither should confirm the round exists.
    if (error || !data) {
      return NextResponse.json({ error: 'Round not found' }, { status: 404 });
    }

    const scorecard = transformGroupPostToScorecard(data);
    if (!scorecard) {
      // Not a golf round, or its scorecard row never got created.
      return NextResponse.json({ error: 'Round not found' }, { status: 404 });
    }

    return NextResponse.json({ scorecard });
  } catch (e) {
    console.error('Unexpected error in GET /api/group-posts/[id]/scorecard:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
