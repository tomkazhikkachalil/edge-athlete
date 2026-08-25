import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { canViewProfile } from '@/lib/privacy';
import { buildHandicapSeries, type EnrichedRound } from '@/lib/golf/handicap';
import { rankStrokeIndexes } from '@/lib/golf/adjusted-gross';

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

    // Handicap: WHS-style estimate — independent of the page's holes/limit
    // filters (its own light fetch). 9-hole rounds now join via the WHS
    // expected-score conversion, and hole-level scores enable the net-
    // double-bogey adjusted gross; both live in buildHandicapSeries, which
    // MUST be a chronological read-time recompute (each round's cap depends
    // on the index as of that round — a stored value would be stale).
    const { data: hcRounds } = await supabase
      .from('golf_rounds')
      .select('id, date, holes, gross_score, course_rating, slope_rating, par, course_id, created_at')
      .eq('profile_id', profileId)
      .in('holes', [9, 18])
      .not('gross_score', 'is', null)
      .not('course_rating', 'is', null)
      .not('slope_rating', 'is', null)
      .order('date', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(60);

    // Hole-level scores (for adjusted gross) + catalog stroke indexes (for
    // exact net double bogey). Both optional per round; absence degrades to
    // the pre-upgrade raw-gross behavior.
    const roundIds = (hcRounds || []).map(r => r.id);
    // 60 rounds × 18 holes = 1,080 rows > PostgREST's 1000-row cap, so a single
    // .in() silently dropped holes from the oldest rounds — the handicap for
    // those degraded to raw-gross TODAY, not just at scale. Chunk the round ids
    // so no batch can exceed the cap (55 rounds × 18 = 990 < 1000).
    const HOLE_BATCH_ROUNDS = 55;
    const holeRows: Array<{ round_id: string; hole_number: number; par: number | null; strokes: number }> = [];
    for (let i = 0; i < roundIds.length; i += HOLE_BATCH_ROUNDS) {
      const batch = roundIds.slice(i, i + HOLE_BATCH_ROUNDS);
      const { data: batchRows } = await supabase
        .from('golf_holes')
        .select('round_id, hole_number, par, strokes')
        .in('round_id', batch)
        .order('hole_number', { ascending: true });
      if (batchRows) holeRows.push(...batchRows);
    }
    const holesByRound = new Map<string, Array<{ hole_number: number; par: number | null; strokes: number }>>();
    for (const h of holeRows || []) {
      const list = holesByRound.get(h.round_id) ?? [];
      list.push(h);
      holesByRound.set(h.round_id, list);
    }

    const courseIds = [...new Set((hcRounds || []).map(r => r.course_id).filter((c): c is string => !!c))];
    const { data: courseRows } = courseIds.length
      ? await supabase.from('golf_courses').select('id, hole_data').in('id', courseIds)
      : { data: [] as never[] };
    const strokeIndexByCourse = new Map<string, Map<number, number>>();
    for (const c of courseRows || []) {
      const m = new Map<number, number>();
      for (const h of (c.hole_data as Array<{ number: number; handicap?: number }> | null) ?? []) {
        if (typeof h.handicap === 'number' && h.handicap > 0) m.set(h.number, h.handicap);
      }
      strokeIndexByCourse.set(c.id, m);
    }

    const enriched: EnrichedRound[] = (hcRounds || []).map(r => {
      const holes = holesByRound.get(r.id);
      // Every hole row needs a par to cap against; a round missing pars
      // falls back to raw gross rather than a half-capped total.
      const usable = holes && holes.length > 0 && holes.every(h => typeof h.par === 'number');
      const si = r.course_id ? strokeIndexByCourse.get(r.course_id) : undefined;
      return {
        date: r.date,
        holes: r.holes,
        gross_score: r.gross_score,
        course_rating: r.course_rating,
        slope_rating: r.slope_rating,
        par: r.par,
        holeScores: usable ? holes!.map(h => ({ par: h.par as number, strokes: h.strokes })) : null,
        allocations:
          usable && si
            ? rankStrokeIndexes(holes!.map(h => si.get(h.hole_number) ?? null))
            : null,
      };
    });

    const { series: handicapSeries, current: currentHandicap, diffs } = buildHandicapSeries(enriched);

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

    return NextResponse.json({ series, summary, handicapSeries, isOwner: profileId === user.id });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('GET /api/golf/trends error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
