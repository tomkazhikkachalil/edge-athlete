import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { isActiveParticipant, countLiveVisibleRounds } from '@/lib/golf/round-status';

/**
 * GET /api/golf/live-now/count
 *
 * The cheap sibling of /api/golf/live-now: returns only `{ count }`, the number
 * of rounds currently live for the viewer, with NONE of the deep scorecard
 * embed (per-hole scores, media, nested courses). It powers the header's Live
 * dot (`useLiveNow`), which polls on EVERY authenticated page once a minute and
 * only ever needs to know whether anything is live — so it must not pull the
 * heavy embed app-wide just to compute a boolean.
 *
 * The counted set matches the deep route's final filter exactly: a live round
 * that is public OR one the viewer actively plays in. Followed users' PRIVATE
 * rounds never count (the deep route filters them out too), so this endpoint
 * needs neither the `follows` query nor the scorecard embed.
 */
export async function GET(request: NextRequest) {
  try {
    const viewer = await requireAuth(request);
    const supabase = getSupabaseAdmin();

    // Rounds the viewer THEMSELVES actively plays in — a private round only
    // counts when the viewer is on the roster. Recent rows only (live is recent).
    const { data: participantRows, error: participantsError } = await supabase
      .from('group_post_participants')
      .select('group_post_id, status')
      .eq('profile_id', viewer.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (participantsError) {
      console.error('live-now/count: participants fetch failed:', participantsError);
      return NextResponse.json({ error: 'Failed to load live rounds' }, { status: 500 });
    }

    const viewerRoundIds = new Set(
      (participantRows || [])
        .filter(r => isActiveParticipant(r.status))
        .map(r => r.group_post_id)
    );

    // Lean columns only — exactly what isRoundLive + the visibility rule read.
    const LEAN_SELECT = 'id, visibility, status, date, last_score_activity_at';
    const activeGolf = () =>
      supabase
        .from('group_posts')
        .select(LEAN_SELECT)
        .eq('type', 'golf_round')
        .in('status', ['pending', 'active']);

    // Two scopes (mirrors the deep route): every public live round, plus the
    // non-public ones the viewer plays in. Separate queries because an empty
    // `id.in.()` is a syntax error rather than an empty match.
    const [publicRes, viewerRes] = await Promise.all([
      activeGolf().eq('visibility', 'public').limit(40),
      viewerRoundIds.size > 0
        ? activeGolf().in('id', [...viewerRoundIds]).limit(40)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (publicRes.error || viewerRes.error) {
      console.error('live-now/count: rounds fetch failed:', publicRes.error || viewerRes.error);
      return NextResponse.json({ error: 'Failed to load live rounds' }, { status: 500 });
    }

    const rows = [...(publicRes.data || []), ...(viewerRes.data || [])];
    const count = countLiveVisibleRounds(rows, viewerRoundIds);

    return NextResponse.json({ count });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('live-now/count: unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
