import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');

    if (!profileId) {
      return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
    }

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
        total_score,
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

    // Calculate stats from rounds
    const completedRounds = (rounds || []).filter(r =>
      (r.gross_score || r.total_score) && r.holes === 18
    );

    // Get scores (prefer gross_score, fall back to total_score)
    const scores = completedRounds
      .map(r => r.gross_score || r.total_score)
      .filter((s): s is number => s !== null && s !== undefined);

    // Last 5 rounds average
    const last5Scores = scores.slice(0, 5);
    const last5Avg = last5Scores.length > 0
      ? Math.round((last5Scores.reduce((a, b) => a + b, 0) / last5Scores.length) * 10) / 10
      : null;

    // Best 18-hole score
    const best18 = scores.length > 0 ? Math.min(...scores) : null;

    // FIR percentage (average across rounds that have it)
    const firValues = completedRounds
      .map(r => r.fir_percentage)
      .filter((f): f is number => f !== null && f !== undefined);
    const avgFir = firValues.length > 0
      ? Math.round(firValues.reduce((a, b) => a + b, 0) / firValues.length)
      : null;

    // GIR percentage (average across rounds that have it)
    const girValues = completedRounds
      .map(r => r.gir_percentage)
      .filter((g): g is number => g !== null && g !== undefined);
    const avgGir = girValues.length > 0
      ? Math.round(girValues.reduce((a, b) => a + b, 0) / girValues.length)
      : null;

    // Average putts per round
    const puttValues = completedRounds
      .map(r => r.total_putts)
      .filter((p): p is number => p !== null && p !== undefined);
    const avgPutts = puttValues.length > 0
      ? Math.round((puttValues.reduce((a, b) => a + b, 0) / puttValues.length) * 10) / 10
      : null;

    // Build highlights response
    const highlights = [
      {
        label: 'Last 5 Avg',
        value: last5Avg !== null ? last5Avg.toString() : null,
        trend: null // Could calculate trend by comparing to previous 5
      },
      {
        label: 'Best 18',
        value: best18 !== null ? best18.toString() : null
      },
      {
        label: 'FIR%',
        value: avgFir !== null ? `${avgFir}%` : null
      },
      {
        label: 'GIR%',
        value: avgGir !== null ? `${avgGir}%` : null
      },
      {
        label: 'Putts/Round',
        value: avgPutts !== null ? avgPutts.toString() : null
      },
      {
        label: 'Rounds',
        value: completedRounds.length > 0 ? completedRounds.length.toString() : null
      }
    ];

    // Build recent activity (for getRecentActivity)
    const recentRounds = (rounds || []).slice(0, 10).map(round => ({
      id: round.id,
      date: round.date,
      course: round.course,
      courseLocation: round.course_location,
      score: round.gross_score || round.total_score,
      par: round.par,
      gir: round.gir_percentage,
      holes: round.holes,
      roundType: round.round_type,
      isComplete: round.is_complete
    }));

    return NextResponse.json({
      highlights,
      recentRounds,
      totalRounds: (rounds || []).length,
      completedRounds: completedRounds.length
    });

  } catch (error) {
    console.error('Golf stats API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
