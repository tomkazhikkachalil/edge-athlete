import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { GROUP_SCORECARD_SELECT, transformGroupPostToScorecard } from '@/lib/golf/scorecard-transform';
import { isRoundLive, isActiveParticipant } from '@/lib/golf/round-status';

/**
 * GET /api/golf/live-now
 * Live rounds involving people the viewer follows (plus their own) — powers
 * the feed's "Live Now" strip and the Explore section. Sports-app "follow
 * live" surface; the same shape will later serve tournament leaderboards.
 *
 * Follow-scoped by construction (like /api/golf/live-round): starts from the
 * followed users' participant rows, never from the public rounds listing.
 */
export async function GET(request: NextRequest) {
  try {
    const viewer = await requireAuth(request);
    const supabase = getSupabaseAdmin();

    // Who the viewer follows (accepted) + themself
    const { data: following } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', viewer.id)
      .eq('status', 'accepted');
    const watchIds = [...new Set([viewer.id, ...(following || []).map(f => f.following_id)])];

    // Rounds any of them are playing in (recent participant rows only —
    // live rounds are by definition recent)
    const { data: participantRows, error: participantsError } = await supabase
      .from('group_post_participants')
      .select('group_post_id, profile_id, status')
      .in('profile_id', watchIds)
      .order('created_at', { ascending: false })
      .limit(100);

    if (participantsError) {
      console.error('live-now: participants fetch failed:', participantsError);
      return NextResponse.json({ error: 'Failed to load live rounds' }, { status: 500 });
    }

    const roundIds = [
      ...new Set(
        (participantRows || [])
          .filter(r => isActiveParticipant(r.status))
          .map(r => r.group_post_id)
      ),
    ];
    if (roundIds.length === 0) return NextResponse.json({ rounds: [] });

    const { data: groupRows, error: roundsError } = await supabase
      .from('group_posts')
      .select(GROUP_SCORECARD_SELECT)
      .in('id', roundIds)
      .eq('type', 'golf_round')
      .eq('status', 'active')
      .limit(20);

    if (roundsError) {
      console.error('live-now: rounds fetch failed:', roundsError);
      return NextResponse.json({ error: 'Failed to load live rounds' }, { status: 500 });
    }

    // Privacy: only surface rounds the viewer could open — public rounds, or
    // rounds the viewer plays in. (Followed users' private rounds stay
    // hidden; the posts API enforces the same rule on tap-through.)
    const rounds = (groupRows || [])
      .map(row => transformGroupPostToScorecard(row))
      .filter(sc => sc !== null)
      .filter(sc => isRoundLive(sc.group_post))
      .filter(sc =>
        sc.group_post.visibility === 'public' ||
        (sc.participants || []).some(
          (p: { participant: { profile_id: string } }) => p.participant.profile_id === viewer.id
        )
      )
      .map(sc => ({
        group_post_id: sc.group_post.id,
        post_id: sc.group_post.post_id ?? null,
        course_name: sc.golf_data.course_name,
        holes_played: sc.golf_data.holes_played,
        date: sc.group_post.date,
        players: (sc.participants || [])
          .filter((p: { participant: { status: string } }) => isActiveParticipant(p.participant.status))
          .map((p: {
            participant: { profile_id: string; profile: { first_name: string | null; last_name: string | null; full_name: string | null; avatar_url: string | null } | null };
            scores: { total_score: number | null; to_par: number | null; holes_completed: number };
          }) => ({
            profile_id: p.participant.profile_id,
            first_name: p.participant.profile?.first_name ?? null,
            last_name: p.participant.profile?.last_name ?? null,
            full_name: p.participant.profile?.full_name ?? null,
            avatar_url: p.participant.profile?.avatar_url ?? null,
            total_score: p.scores.total_score,
            to_par: p.scores.to_par,
            thru: p.scores.holes_completed,
          })),
      }))
      // Rounds with a feed post only (tap target); newest first
      .filter(r => r.post_id !== null)
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

    return NextResponse.json({ rounds });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('live-now: unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
