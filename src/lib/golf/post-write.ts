import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Golf's post-creation write path — moved intact from api/posts/route.ts so
 * the shared route keeps ONE sport dispatch point. Behavior-preserving:
 * same dedup, same inserts, same rollback, same error messages.
 */

export interface GolfHoleInput {
  hole: number;
  par: number;
  yardage?: number;
  score?: number;
  putts?: number;
  fairway?: string;
  gir?: boolean;
  notes?: string;
}

export interface GolfPostData {
  date: string;
  courseName: string;
  courseLocation?: string;
  teeBox?: string;
  holes?: string;
  roundType?: string;
  coursePar?: number;
  weather?: string;
  temperature?: number;
  wind?: string;
  courseRating?: number;
  courseSlope?: number;
  holesData?: GolfHoleInput[];
}

export type GolfWriteResult =
  | { ok: true; roundId: string | null }
  | { ok: false; message: 'Failed to save golf round' | 'Failed to save hole-by-hole scores' };

/** Pure: shape hole inputs into golf_holes rows (drops holes without a
 *  score; fairway 'hit'→true, 'na'→null, anything else→false). */
export function buildHoleRecords(holesData: GolfHoleInput[], roundId: string) {
  return holesData
    .filter(hole => hole.score !== undefined)
    .map(hole => ({
      round_id: roundId,
      hole_number: hole.hole,
      par: hole.par,
      distance_yards: hole.yardage,
      strokes: hole.score as number,
      putts: hole.putts,
      fairway_hit: hole.fairway === 'hit' ? true : hole.fairway === 'na' ? null : false,
      green_in_regulation: hole.gir || false,
      notes: hole.notes || null,
    }));
}

/**
 * Create (or reuse) the golf_rounds row + golf_holes for a golf post.
 * A second same-day/same-course post may REUSE the existing round, but only
 * when it brings no new hole data — the old behavior overwrote the round's
 * metadata and delete-reinserted its holes, silently rewriting the FIRST
 * post's scorecard (both posts share round_id).
 */
export async function createGolfRoundEntities(
  supabase: SupabaseClient,
  userId: string,
  golfData: GolfPostData
): Promise<GolfWriteResult> {
  let roundId: string | null = null;

  const hasNewHoleData = !!(golfData.holesData && golfData.holesData.length > 0);
  const { data: existingRounds } = await supabase
    .from('golf_rounds')
    .select('id')
    .eq('profile_id', userId)
    .eq('date', golfData.date)
    .eq('course', golfData.courseName)
    .limit(1);

  if (existingRounds && existingRounds.length > 0 && !hasNewHoleData) {
    // Attach this post to the existing round as-is (no rewrite)
    roundId = existingRounds[0].id;
  } else {
    // Create new comprehensive round
    const { data: newRound, error: roundError } = await supabase
      .from('golf_rounds')
      .insert({
        profile_id: userId,
        date: golfData.date,
        course: golfData.courseName,
        course_location: golfData.courseLocation || null,
        tee: golfData.teeBox || null,
        holes: parseInt(golfData.holes ?? '') || 18,
        round_type: golfData.roundType || 'outdoor',
        par: golfData.coursePar || 72,
        weather: golfData.weather || null,
        temperature: golfData.temperature || null,
        wind: golfData.wind || null,
        course_rating: golfData.courseRating || null,
        slope_rating: golfData.courseSlope || null,
      })
      .select()
      .single();

    if (roundError || !newRound) {
      // The post hasn't been created yet — abort so the user's full
      // hole-by-hole entry isn't silently discarded behind a "success".
      console.error('Round creation error:', roundError);
      return { ok: false, message: 'Failed to save golf round' };
    }
    roundId = newRound.id;
  }

  // Now handle hole-by-hole data
  if (roundId && golfData.holesData && golfData.holesData.length > 0) {
    const holeRecords = buildHoleRecords(golfData.holesData, roundId);

    if (holeRecords.length > 0) {
      // Delete existing holes for this round first
      await supabase.from('golf_holes').delete().eq('round_id', roundId);

      // Insert new hole data
      const { error: holesError } = await supabase.from('golf_holes').insert(holeRecords);

      if (holesError) {
        console.error('Holes creation error:', holesError);
        // Pre-post: abort rather than leave a zero-hole round and a
        // "successful" post with a missing scorecard.
        await supabase.from('golf_rounds').delete().eq('id', roundId);
        return { ok: false, message: 'Failed to save hole-by-hole scores' };
      }

      // Calculate round stats
      try {
        await supabase.rpc('calculate_round_stats', { round_uuid: roundId });
      } catch (statsError) {
        console.error('Stats calculation error:', statsError);
      }
    }
  }

  return { ok: true, roundId };
}
