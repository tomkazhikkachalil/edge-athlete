import type { SupabaseClient } from '@supabase/supabase-js';
import { buildHandicapSeries, type EnrichedRound, type HandicapSeriesResult } from './handicap';
import { rankStrokeIndexes } from './adjusted-gross';

// ── Server-side handicap computation ─────────────────────────────────────────
// The fetch+compute behind the WHS-style estimate, extracted from
// /api/golf/trends so the profile skill card can share it. The computation
// MUST stay a chronological read-time recompute (each round's cap depends on
// the index as of that round — a stored value would be stale), so both
// callers pay the same fetch; cost is controlled at the route layer
// (public-profile CDN cache / private max-age), not by thinning this query.

/**
 * Fetch a profile's handicap-eligible rounds (rated, 9 or 18 holes, most
 * recent 60) with hole-level scores and catalog stroke indexes, and run
 * `buildHandicapSeries` over them. Caller is responsible for any privacy
 * gate — this reads whatever the given client can see.
 */
export async function fetchHandicapComputation(
  profileId: string,
  supabase: SupabaseClient
): Promise<HandicapSeriesResult> {
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

  return buildHandicapSeries(enriched);
}
