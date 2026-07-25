import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/lib/auth-server';
import { isActiveParticipant } from '@/lib/golf/round-status';
import { pickLiveRound, type LiveRoundRow } from '@/lib/golf/live-round';

/**
 * GET /api/golf/live-round
 * The current user's in-progress golf round, if any — powers the feed's
 * "continue scoring" banner.
 *
 * Purpose-built instead of GET /api/group-posts?status=active: the
 * group_posts SELECT RLS includes every PUBLIC round on the platform, so the
 * generic listing can't answer "MY live round" without leaking the rest.
 * This route starts from the user's own participant rows.
 *
 * Response: { live_round: { post_id, group_post_id, participant_id,
 *                           course_name } | null }
 */
export async function GET(request: NextRequest) {
  const supabase = getServerClient(request);

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { data: rows, error: fetchError } = await supabase
      .from('group_post_participants')
      .select(`
        id,
        status,
        scores:golf_participant_scores ( holes_completed ),
        group_post:group_post_id (
          id,
          type,
          status,
          date,
          post_id,
          golf_data:golf_scorecard_data ( course_name, holes_played ),
          all_participants:group_post_participants (
            scores:golf_participant_scores ( updated_at )
          )
        )
      `)
      .eq('profile_id', user.id)
      // Only recent rounds can be live (±48h window) — keep the scan tiny
      .order('created_at', { ascending: false })
      .limit(25);

    if (fetchError) {
      console.error('live-round: fetch failed:', fetchError);
      return NextResponse.json({ error: 'Failed to check live rounds' }, { status: 500 });
    }

    const candidates: LiveRoundRow[] = (rows || [])
      .filter(r => isActiveParticipant(r.status))
      .map((r): LiveRoundRow | null => {
        // PostgREST to-one embeds arrive as single-element arrays here
        const gp = Array.isArray(r.group_post) ? r.group_post[0] : r.group_post;
        if (!gp || gp.type !== 'golf_round') return null;
        const golfData = Array.isArray(gp.golf_data) ? gp.golf_data[0] : gp.golf_data;
        const scores = Array.isArray(r.scores) ? r.scores[0] : r.scores;
        // Round-wide newest score write — the 6h auto-end rule hides the
        // banner for quiet rounds
        let lastActivity: string | null = null;
        for (const ap of (gp.all_participants || []) as Array<{ scores: { updated_at?: string | null }[] | { updated_at?: string | null } | null }>) {
          const s = Array.isArray(ap.scores) ? ap.scores[0] : ap.scores;
          if (s?.updated_at && (!lastActivity || s.updated_at > lastActivity)) {
            lastActivity = s.updated_at;
          }
        }
        return {
          participant_id: r.id,
          holes_completed: scores?.holes_completed ?? null,
          group_post: {
            id: gp.id,
            status: gp.status,
            date: gp.date,
            post_id: gp.post_id,
            course_name: golfData?.course_name ?? null,
            holes_played: golfData?.holes_played ?? null,
            last_score_activity_at: lastActivity,
          },
        };
      })
      .filter((r): r is LiveRoundRow => r !== null);

    const live = pickLiveRound(candidates);
    if (!live) {
      return NextResponse.json({ live_round: null });
    }

    // Resolve the feed post: prefer the stored reverse link (set at creation
    // since Phase 5, backfilled by migration 033), fall back to a lookup.
    let postId = live.group_post.post_id ?? null;
    if (!postId) {
      const { data: post } = await supabase
        .from('posts')
        .select('id')
        .eq('group_post_id', live.group_post.id)
        .maybeSingle();
      postId = post?.id ?? null;
    }

    // A round with no feed post is unreachable (legacy orphan) — never emit
    // a banner that deep-links nowhere.
    if (!postId) {
      return NextResponse.json({ live_round: null });
    }

    return NextResponse.json({
      live_round: {
        post_id: postId,
        group_post_id: live.group_post.id,
        participant_id: live.participant_id,
        course_name: live.group_post.course_name,
      },
    });
  } catch (error) {
    console.error('Unexpected error in GET /api/golf/live-round:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
