import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { canViewProfile } from '@/lib/privacy';
import { isHandicapEligible, scoreDifferential, handicapIndex } from '@/lib/golf/handicap';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TrendPoint {
  round_id: string;
  date: string;
  course: string;
  holes: number;
  gross_score: number;
  par: number;
  to_par: number;
  putts_per_hole: number | null;
  fir_pct: number | null;
  gir_pct: number | null;
}

// ── GET /api/golf/trends ──────────────────────────────────────────────────────
// Chronological per-round series + summary aggregates for the trends
// dashboard. Own rounds by default; another profile via ?profileId= behind
// the standard visibility gate.
//
// Filters: ?holes=9|18   Range: ?limit= last N rounds (default 50, max 200)
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);

    const profileId = searchParams.get('profileId') || user.id;
    if (!UUID_RE.test(profileId)) {
      return NextResponse.json({ error: 'Invalid profileId' }, { status: 400 });
    }
    if (profileId !== user.id) {
      const { canView } = await canViewProfile(profileId, user.id);
      if (!canView) {
        return NextResponse.json({ error: 'This profile is private' }, { status: 403 });
      }
    }

    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 2), 200);
    const holesFilter = searchParams.get('holes');

    let query = supabase
      .from('golf_rounds')
      .select('id, date, course, holes, par, gross_score, total_putts, fir_percentage, gir_percentage, created_at')
      .eq('profile_id', profileId)
      .not('gross_score', 'is', null)
      .gt('gross_score', 0);

    if (holesFilter === '9' || holesFilter === '18') {
      query = query.eq('holes', parseInt(holesFilter, 10));
    }

    // Fetch the most recent N, then reverse to chronological for charting
    const { data: rounds, error } = await query
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('GET /api/golf/trends error:', error);
      return NextResponse.json({ error: 'Failed to load trends' }, { status: 500 });
    }

    const series: TrendPoint[] = (rounds || [])
      .reverse()
      .map(r => ({
        round_id: r.id,
        date: r.date,
        course: r.course,
        holes: r.holes,
        gross_score: r.gross_score,
        par: r.par,
        to_par: r.gross_score - r.par,
        putts_per_hole: r.total_putts && r.total_putts > 0 && r.holes > 0
          ? Math.round((r.total_putts / r.holes) * 100) / 100
          : null,
        // 0% is stored both for "hit no fairways" and "didn't track" — treat 0
        // as untracked for trend purposes (a real all-misses round is rare;
        // a missing-data zero poisons the chart).
        fir_pct: r.fir_percentage && r.fir_percentage > 0 ? Math.round(r.fir_percentage) : null,
        gir_pct: r.gir_percentage && r.gir_percentage > 0 ? Math.round(r.gir_percentage) : null,
      }));

    // Aggregates
    const lastN = (n: number) => series.slice(-n);
    const avg = (vals: number[]) =>
      vals.length > 0 ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10 : null;

    const toParValues = series.map(p => p.to_par);
    const puttsValues = series.map(p => p.putts_per_hole).filter((v): v is number => v !== null);
    const firValues = series.map(p => p.fir_pct).filter((v): v is number => v !== null);
    const girValues = series.map(p => p.gir_pct).filter((v): v is number => v !== null);

    // Handicap: WHS-style estimate from 18-hole rounds with rating+slope —
    // independent of the page's holes/limit filters (its own light fetch).
    const { data: hcRounds } = await supabase
      .from('golf_rounds')
      .select('date, holes, gross_score, course_rating, slope_rating, created_at')
      .eq('profile_id', profileId)
      .eq('holes', 18)
      .not('gross_score', 'is', null)
      .not('course_rating', 'is', null)
      .not('slope_rating', 'is', null)
      .order('date', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(60);

    const eligible = (hcRounds || []).filter(isHandicapEligible);
    const diffs = eligible.map(r =>
      scoreDifferential(r.gross_score as number, r.course_rating as number, r.slope_rating as number)
    );
    const currentHandicap = handicapIndex(diffs);

    // Index-over-time: recompute after each eligible round (from the 3rd on)
    const handicapSeries = eligible
      .map((r, i) => {
        const result = handicapIndex(diffs.slice(0, i + 1));
        return result ? { date: r.date, index: result.index } : null;
      })
      .filter((p): p is { date: string; index: number } => p !== null);

    const summary = {
      rounds: series.length,
      avgToParLast5: avg(lastN(5).map(p => p.to_par)),
      avgToParAll: avg(toParValues),
      bestToPar: toParValues.length > 0 ? Math.min(...toParValues) : null,
      avgPuttsPerHole: avg(puttsValues),
      avgFirPct: avg(firValues),
      avgGirPct: avg(girValues),
      handicapIndex: currentHandicap?.index ?? null,
      handicapRounds: currentHandicap?.roundsCounted ?? eligible.length,
    };

    return NextResponse.json({ series, summary, handicapSeries, isOwner: profileId === user.id });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('GET /api/golf/trends error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
