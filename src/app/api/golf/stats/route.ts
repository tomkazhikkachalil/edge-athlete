import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { canViewProfile } from '@/lib/privacy';

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

    // Solo completed rounds (posted via the scorecard form) — 9-hole rounds
    // count too; the aggregator decides which tiles each length may feed
    const completedRounds = (rounds || []).filter(r =>
      r.gross_score && (r.holes === 18 || r.holes === 9)
    );

    const soloRoundLikes: CompletedRoundLike[] = completedRounds.map(r => ({
      grossScore: r.gross_score as number,
      date: r.date,
      holes: r.holes,
      source: 'solo',
      fir: r.fir_percentage,
      gir: r.gir_percentage,
      putts: r.total_putts,
    }));

    // Group/live rounds no longer need a separate query here: completed
    // group rounds MIRROR into golf_rounds per participant (round-mirror.ts,
    // migration 039), so the solo query above already includes them — with
    // real pars and full FIR/GIR/putt stats. Merging participant scores on
    // top would double-count.
    const allRoundLikes = soloRoundLikes;
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
      totalRounds: (rounds || []).length,
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
