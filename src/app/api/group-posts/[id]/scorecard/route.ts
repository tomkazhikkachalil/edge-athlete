import { NextRequest, NextResponse } from 'next/server';
import { readScorecardEventContext } from '@/lib/sport-events/scorecard-context';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { GROUP_SCORECARD_SELECT, transformGroupPostToScorecard } from '@/lib/golf/scorecard-transform';
import { canViewSharedRound } from '@/lib/golf/round-access';
import { reportRouteError } from '@/lib/observability/report';

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
 * Access control is the APP-LAYER gate (canViewSharedRound), and the read runs
 * on the ADMIN client. This route used to read through the RLS client, which
 * looked correct but silently broke live rounds for every non-participant:
 * PostgREST filters each embed independently, and the participants/scores
 * tables lacked the public-visibility branch that group_posts and
 * group_post_media have — so a stranger got a 200 with full media and
 * participants: []. Media visible, leaderboard empty, no error anywhere.
 * The gate mirrors the group_posts RLS rule exactly (creator OR public OR
 * participant) — see round-access.ts for the sync obligation with 063.
 *
 * Events phase 4: auth is OPTIONAL — a signed-out reader gets a PUBLIC round
 * (the gate's anonymous branch); anything else stays the same 404 as
 * not-found, never a 401 that confirms the round exists.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user } = await getServerAuth(request);
  const viewerId = user?.id ?? null;

  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Round not found' }, { status: 404 });
    }

    const { data, error } = await getSupabaseAdmin()
      .from('group_posts')
      .select(GROUP_SCORECARD_SELECT)
      .eq('id', id)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({ error: 'Round not found' }, { status: 404 });
    }

    // Denied and missing are indistinguishable on purpose — a 404 must not
    // confirm the round exists (same semantics as GET /api/posts).
    const participants = Array.isArray(data.participants) ? data.participants : [];
    const allowed = canViewSharedRound({
      viewerId,
      creatorId: (data as { creator_id?: string }).creator_id ?? null,
      visibility: (data as { visibility?: string }).visibility ?? null,
      participantProfileIds: participants
        .map((p: { profile_id?: string }) => p.profile_id)
        .filter((v: string | undefined): v is string => !!v),
    });
    if (!allowed) {
      return NextResponse.json({ error: 'Round not found' }, { status: 404 });
    }

    const scorecard = transformGroupPostToScorecard(data);
    if (!scorecard) {
      // Not a golf round, or its scorecard row never got created.
      return NextResponse.json({ error: 'Round not found' }, { status: 404 });
    }

    // Events program (203): the event context rides the payload when the
    // round belongs to a sport event — the live page mounts the group card
    // and links back to the event from it.
    const roundId = (data as { sport_event_round_id?: string | null }).sport_event_round_id ?? null;
    const sport_event = roundId ? await readScorecardEventContext(getSupabaseAdmin(), roundId, viewerId) : null;
    return NextResponse.json({ scorecard: { ...scorecard, sport_event } });
  } catch (e) {
    reportRouteError('Unexpected error in GET /api/group-posts/[id]/scorecard:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
