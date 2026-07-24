import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { canViewProfile } from '@/lib/privacy';
import { isActiveParticipant } from '@/lib/golf/round-status';
import { aggregateGolfHighlights, type CompletedRoundLike } from '@/lib/golf/stats-aggregate';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');

    if (!profileId) {
      return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
    }

    // Auth + privacy: golf rounds are performance data. Non-owners may only
    // see them if the profile's privacy allows it (public or approved fan).
    const viewer = await requireAuth(request);
    if (viewer.id !== profileId) {
      const { canView } = await canViewProfile(profileId, viewer.id);
      if (!canView) {
        // Return an empty-but-valid stats shape rather than 403 — the profile
        // page renders "—" tiles for viewers without access.
        return NextResponse.json({
          highlights: [],
          recentRounds: [],
          totalRounds: 0,
          completedRounds: 0,
        });
      }
    }

    const supabase = getSupabaseAdmin();

    // Fetch golf rounds for this profile
    const { data: rounds, error: roundsError } = await supabase
      .from('golf_rounds')
      .select(`
        id,
        date,
        course,
        course_location,
        tee,
        holes,
        par,
        gross_score,
        fir_percentage,
        gir_percentage,
        total_putts,
        is_complete,
        round_type,
        created_at
      `)
      .eq('profile_id', profileId)
      .order('date', { ascending: false });

    if (roundsError) {
      console.error('Error fetching golf rounds:', roundsError);
      return NextResponse.json({ error: 'Failed to fetch golf data' }, { status: 500 });
    }

    // Solo completed rounds (posted via the scorecard form)
    const completedRounds = (rounds || []).filter(r =>
      r.gross_score && r.holes === 18
    );

    const soloRoundLikes: CompletedRoundLike[] = completedRounds.map(r => ({
      grossScore: r.gross_score as number,
      date: r.date,
      source: 'solo',
      fir: r.fir_percentage,
      gir: r.gir_percentage,
      putts: r.total_putts,
    }));

    // Shared-round scores: multi-player rounds live in group_posts /
    // golf_participant_scores and NEVER write golf_rounds — without this
    // query the profile tiles silently ignore every shared round the athlete
    // played. Only fully-scored 18-hole rounds count (same rule as solo).
    // Per-hole FIR/GIR/putts for shared rounds is a follow-up.
    const { data: sharedRows, error: sharedError } = await supabase
      .from('group_post_participants')
      .select(`
        status,
        group_post:group_post_id (
          type,
          date,
          golf_data:golf_scorecard_data ( holes_played )
        ),
        scores:golf_participant_scores ( total_score, holes_completed )
      `)
      .eq('profile_id', profileId);

    if (sharedError) {
      // Solo stats still render — log and continue rather than failing the tiles
      console.error('Error fetching shared-round scores:', sharedError);
    }

    const sharedRoundLikes: CompletedRoundLike[] = (sharedRows || [])
      .map((row): CompletedRoundLike | null => {
        if (!isActiveParticipant(row.status)) return null;
        const gp = Array.isArray(row.group_post) ? row.group_post[0] : row.group_post;
        if (!gp || gp.type !== 'golf_round' || !gp.date) return null;
        const golfData = Array.isArray(gp.golf_data) ? gp.golf_data[0] : gp.golf_data;
        if (golfData?.holes_played !== 18) return null;
        const scores = Array.isArray(row.scores) ? row.scores[0] : row.scores;
        if (!scores?.total_score || scores.holes_completed !== 18) return null;
        return { grossScore: scores.total_score, date: gp.date, source: 'shared' };
      })
      .filter((r): r is CompletedRoundLike => r !== null);

    const allRoundLikes = [...soloRoundLikes, ...sharedRoundLikes];
    const highlights = aggregateGolfHighlights(allRoundLikes);

    // Build recent activity (for getRecentActivity)
    const recentRounds = (rounds || []).slice(0, 10).map(round => ({
      id: round.id,
      date: round.date,
      course: round.course,
      courseLocation: round.course_location,
      score: round.gross_score,
      par: round.par,
      gir: round.gir_percentage,
      holes: round.holes,
      roundType: round.round_type,
      isComplete: round.is_complete
    }));

    return NextResponse.json({
      highlights,
      // recentRounds stays solo-only: shared rounds have no par/course_location
      // in this shape and the activity list renders them via their feed posts
      recentRounds,
      totalRounds: (rounds || []).length + sharedRoundLikes.length,
      completedRounds: allRoundLikes.length
    });

  } catch (error) {
    if (error instanceof Response) return error;
    console.error('Golf stats API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
