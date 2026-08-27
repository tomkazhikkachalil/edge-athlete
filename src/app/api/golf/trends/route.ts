import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { canViewProfile } from '@/lib/privacy';
import { fetchHandicapComputation } from '@/lib/golf/handicap-server';

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
    // Optional auth (Stats Hub round): the profile skill breakdown embeds
    // these trends, and a public profile is viewable logged-out — same gate
    // ladder as the skill-cards route. Own-view behavior (no ?profileId=,
    // or your own id) is unchanged.
    let currentUserId: string | null = null;
    try {
      const user = await requireAuth(request);
      currentUserId = user.id;
    } catch {
      currentUserId = null;
    }
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);

    const profileId = searchParams.get('profileId') || currentUserId;
    if (!profileId) {
      // Anonymous with no target: nothing to show.
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (!UUID_RE.test(profileId)) {
      return NextResponse.json({ error: 'Invalid profileId' }, { status: 400 });
    }
    if (profileId !== currentUserId) {
      if (currentUserId) {
        const { canView } = await canViewProfile(profileId, currentUserId);
        if (!canView) {
          return NextResponse.json({ error: 'This profile is private' }, { status: 403 });
        }
      } else {
        // canViewProfile returns false for a null viewer even on public
        // profiles, so the anonymous branch checks visibility directly —
        // modeled on the skill-cards sibling gate.
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, visibility')
          .eq('id', profileId)
          .single();
        if (!profile) {
          return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
        }
        if (profile.visibility !== 'public') {
          return NextResponse.json({ error: 'This profile is private' }, { status: 403 });
        }
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

    // Handicap: WHS-style estimate — independent of the page's holes/limit
    // filters (its own fetch, shared with the profile skill card via
    // fetchHandicapComputation, which owns the read-time-recompute
    // invariant).
    const { series: handicapSeries, current: currentHandicap, diffs } =
      await fetchHandicapComputation(profileId, supabase);

    const summary = {
      rounds: series.length,
      avgToParLast5: avg(lastN(5).map(p => p.to_par)),
      avgToParAll: avg(toParValues),
      bestToPar: toParValues.length > 0 ? Math.min(...toParValues) : null,
      avgPuttsPerHole: avg(puttsValues),
      avgFirPct: avg(firValues),
      avgGirPct: avg(girValues),
      handicapIndex: currentHandicap?.index ?? null,
      handicapRounds: currentHandicap?.roundsCounted ?? diffs.length,
    };

    return NextResponse.json({ series, summary, handicapSeries, isOwner: profileId === currentUserId });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('GET /api/golf/trends error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
