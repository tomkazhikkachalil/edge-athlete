// ── Completed group round → golf_rounds mirror ────────────────────────────────
// When a group round (shared OR solo-live) reaches 'completed', write a real
// golf_rounds (+ golf_holes) row for every participant who scored. This is
// what makes live rounds first-class citizens of the stats world: trends,
// handicap, the rounds list/detail pages, recentRounds, and the highlight
// tiles all read golf_rounds — one pipeline for every way a round is played.
//
// Idempotent: golf_rounds has UNIQUE(group_post_id, profile_id) (migration
// 039); re-runs (late score edits on a completed round) upsert the round row
// and rewrite its holes. Best-effort like advanceRoundStatus — a mirror
// failure must never fail the triggering save.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isActiveParticipant } from './round-status';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export interface MirrorHoleInput {
  hole_number: number;
  strokes: number;
  putts: number | null;
  fairway_hit: boolean | null;
  green_in_regulation: boolean | null;
}

/** Pure: map a participant's group scores + round hole_data to golf_holes
 *  rows (par from hole_data, par-4 fallback). Exported for tests. */
export function buildMirrorHoles(
  holeScores: MirrorHoleInput[],
  holeData: { hole: number; par: number; yardage?: number }[] | null
): Array<{
  hole_number: number;
  par: number;
  distance_yards: number | null;
  strokes: number;
  putts: number | null;
  fairway_hit: boolean | null;
  green_in_regulation: boolean | null;
}> {
  return holeScores.map(h => {
    const course = holeData?.find(c => c.hole === h.hole_number);
    return {
      hole_number: h.hole_number,
      par: course?.par ?? 4,
      distance_yards: course?.yardage ?? null,
      strokes: h.strokes,
      putts: h.putts,
      fairway_hit: h.fairway_hit,
      green_in_regulation: h.green_in_regulation,
    };
  });
}

/**
 * Mirror a completed group round into golf_rounds for each scoring
 * participant. `admin` must be the service-role client (writes rounds for
 * OTHER users' profiles).
 */
export async function mirrorCompletedRound(admin: Admin, groupPostId: string): Promise<void> {
  try {
    const { data: round, error } = await admin
      .from('group_posts')
      .select(`
        id,
        status,
        date,
        golf_data:golf_scorecard_data (
          course_name, round_type, holes_played, tee_color,
          slope_rating, course_rating, hole_data
        ),
        participants:group_post_participants (
          profile_id,
          status,
          scores:golf_participant_scores (
            total_score,
            holes_completed,
            hole_scores:golf_hole_scores (
              hole_number, strokes, putts, fairway_hit, green_in_regulation
            )
          )
        )
      `)
      .eq('id', groupPostId)
      .maybeSingle();

    if (error || !round) {
      if (error) console.error('mirrorCompletedRound: fetch failed:', error);
      return;
    }
    if (round.status !== 'completed') return; // only finished rounds mirror

    const golfData = Array.isArray(round.golf_data) ? round.golf_data[0] : round.golf_data;
    if (!golfData) return;
    const holeData = (golfData.hole_data ?? null) as { hole: number; par: number; yardage?: number }[] | null;
    const holesPlayed: number = golfData.holes_played ?? 18;
    const coursePar = holeData && holeData.length > 0
      ? holeData.reduce((sum, h) => sum + h.par, 0)
      : holesPlayed * 4;

    for (const p of round.participants || []) {
      if (!isActiveParticipant(p.status)) continue;
      const scores = Array.isArray(p.scores) ? p.scores[0] : p.scores;
      const holeScores: MirrorHoleInput[] = scores?.hole_scores || [];
      if (!scores?.total_score || holeScores.length === 0) continue; // never scored

      const { data: mirrored, error: upsertError } = await admin
        .from('golf_rounds')
        .upsert(
          {
            profile_id: p.profile_id,
            group_post_id: round.id,
            date: round.date,
            course: golfData.course_name,
            tee: golfData.tee_color ?? null,
            holes: holesPlayed,
            par: coursePar,
            gross_score: scores.total_score,
            total_putts: holeScores.reduce((s, h) => s + (h.putts ?? 0), 0) || null,
            course_rating: golfData.course_rating ?? null,
            slope_rating: golfData.slope_rating ?? null,
            round_type: golfData.round_type ?? 'outdoor',
            is_complete: (scores.holes_completed ?? 0) >= holesPlayed,
          },
          { onConflict: 'group_post_id,profile_id' }
        )
        .select('id')
        .single();

      if (upsertError || !mirrored) {
        console.error('mirrorCompletedRound: round upsert failed:', upsertError);
        continue;
      }

      // Holes: delete-and-reinsert (same pattern as the solo posts route)
      await admin.from('golf_holes').delete().eq('round_id', mirrored.id);
      const holeRows = buildMirrorHoles(holeScores, holeData).map(h => ({
        ...h,
        round_id: mirrored.id,
      }));
      if (holeRows.length > 0) {
        const { error: holesError } = await admin.from('golf_holes').insert(holeRows);
        if (holesError) {
          console.error('mirrorCompletedRound: holes insert failed:', holesError);
          continue;
        }
      }

      // Recompute FIR/GIR/putt aggregates the same way solo rounds do
      const { error: rpcError } = await admin.rpc('calculate_round_stats', { round_uuid: mirrored.id });
      if (rpcError) {
        // Non-fatal — gross/par are already right; percentages recompute on
        // the next write
        console.error('mirrorCompletedRound: calculate_round_stats failed:', rpcError);
      }
    }
  } catch (e) {
    console.error('mirrorCompletedRound: unexpected error:', e);
  }
}
