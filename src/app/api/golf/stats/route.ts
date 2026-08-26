import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { canViewProfile } from '@/lib/privacy';

import { aggregateGolfHighlights, type CompletedRoundLike } from '@/lib/golf/stats-aggregate';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');

    if (!profileId || !isUuid(profileId)) {
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
          years: [],
        });
      }
    }

    const supabase = getSupabaseAdmin();

    // Optional ?year= filter, validated BEFORE the query so it can scope the
    // fetch in SQL (the old JS filter fetched the ENTIRE history — 14 columns
    // per round — and silently corrupted past PostgREST's 1000-row cap).
    const yearParam = searchParams.get('year');
    let year: number | null = null;
    if (yearParam) {
      year = parseInt(yearParam, 10);
      if (!Number.isFinite(year) || year < 1900 || year > 2200) {
        return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
      }
    }

    // Fetch golf rounds for this profile (year-scoped in SQL when asked)
    let roundsQuery = supabase
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
    if (year !== null) {
      roundsQuery = roundsQuery
        .gte('date', `${year}-01-01`)
        .lt('date', `${year + 1}-01-01`);
    }
    const { data: rounds, error: roundsError } = await roundsQuery;

    if (roundsError) {
      console.error('Error fetching golf rounds:', roundsError);
      return NextResponse.json({ error: 'Failed to fetch golf data' }, { status: 500 });
    }

    // Years present across ALL rounds (always unfiltered) — powers the
    // profile-page year selector. One aggregate RPC (migration 126, string-
    // sliced from the DATE column exactly like the old JS derivation) instead
    // of deriving from a full-history fetch.
    const { data: yearsData, error: yearsError } = await supabase.rpc('get_golf_round_years', {
      p_profile_id: profileId,
    });
    if (yearsError) console.error('[golf/stats] get_golf_round_years failed:', yearsError);
    const years = (yearsData as number[] | null) ?? [];

    const scopedRounds = rounds || [];

    // Solo completed rounds (posted via the scorecard form) — 9-hole rounds
    // count too; the aggregator decides which tiles each length may feed
    const completedRounds = scopedRounds.filter(r =>
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
    const recentRounds = scopedRounds.slice(0, 10).map(round => ({
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
      totalRounds: scopedRounds.length,
      completedRounds: allRoundLikes.length,
      years,
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
