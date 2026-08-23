import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { canViewProfile } from '@/lib/privacy';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── GET /api/golf/rounds/[roundId] ────────────────────────────────────────────
// Round + hole-by-hole data. Visible to the owner, or to viewers permitted to
// see the owner's profile (same rule as the rest of the app).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roundId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const supabase = getSupabaseAdmin();
    const { roundId } = await params;

    if (!UUID_RE.test(roundId)) {
      return NextResponse.json({ error: 'Round not found' }, { status: 404 });
    }

    const { data: round, error } = await supabase
      .from('golf_rounds')
      .select(`
        id, profile_id, date, course, course_location, tee, holes, round_type,
        par, gross_score, total_putts, fir_percentage, gir_percentage,
        weather, temperature, wind, course_rating, slope_rating, notes,
        is_complete, created_at,
        course_info:golf_courses (
          id, name, city, region, lat, lng, description, description_attribution,
          architect, year_built, course_type, website
        ),
        golf_holes (
          hole_number, par, strokes, putts, fairway_hit,
          green_in_regulation, distance_yards, notes
        )
      `)
      .eq('id', roundId)
      .maybeSingle();

    if (error) {
      console.error('GET /api/golf/rounds/[id] error:', error);
      return NextResponse.json({ error: 'Failed to load round' }, { status: 500 });
    }
    if (!round) {
      return NextResponse.json({ error: 'Round not found' }, { status: 404 });
    }

    const isOwner = round.profile_id === user.id;
    if (!isOwner) {
      const { canView } = await canViewProfile(round.profile_id, user.id);
      if (!canView) {
        // 404, not 403 — don't confirm a hidden round's existence
        return NextResponse.json({ error: 'Round not found' }, { status: 404 });
      }
    }

    round.golf_holes?.sort(
      (a: { hole_number: number }, b: { hole_number: number }) => a.hole_number - b.hole_number
    );

    return NextResponse.json({ round, isOwner });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('GET /api/golf/rounds/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── PATCH /api/golf/rounds/[roundId] ──────────────────────────────────────────
// Owner-only. Updates hole scores (upsert per hole_number) and recalculates
// the round's cached stats via calculate_round_stats.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ roundId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const supabase = getSupabaseAdmin();
    const { roundId } = await params;

    if (!UUID_RE.test(roundId)) {
      return NextResponse.json({ error: 'Round not found' }, { status: 404 });
    }

    const { data: round } = await supabase
      .from('golf_rounds')
      .select('id, profile_id, group_post_id')
      .eq('id', roundId)
      .maybeSingle();

    if (!round) {
      return NextResponse.json({ error: 'Round not found' }, { status: 404 });
    }
    if (round.profile_id !== user.id) {
      return NextResponse.json({ error: 'Only the round owner can edit it' }, { status: 403 });
    }

    const body = await request.json();

    // Optional course rating / slope backfill — the key that unlocks the
    // computed handicap for rounds logged before the fields were visible.
    // `undefined` = leave unchanged; null or a value = write it.
    const hasRatingField = 'course_rating' in (body ?? {});
    const hasSlopeField = 'slope_rating' in (body ?? {});
    let courseRating: number | null = null;
    let slopeRating: number | null = null;
    if (hasRatingField && body.course_rating !== null) {
      courseRating = Number(body.course_rating);
      if (!Number.isFinite(courseRating) || courseRating < 50 || courseRating > 90) {
        return NextResponse.json({ error: 'Invalid course_rating (50–90)' }, { status: 400 });
      }
    }
    if (hasSlopeField && body.slope_rating !== null) {
      slopeRating = Number(body.slope_rating);
      if (!Number.isInteger(slopeRating) || slopeRating < 55 || slopeRating > 155) {
        return NextResponse.json({ error: 'Invalid slope_rating (55–155)' }, { status: 400 });
      }
    }

    const holes = body?.holes;
    if (!Array.isArray(holes) || holes.length === 0) {
      if (!hasRatingField && !hasSlopeField) {
        return NextResponse.json({ error: 'holes array is required' }, { status: 400 });
      }
    } else if (holes.length > 18) {
      return NextResponse.json({ error: 'Too many holes' }, { status: 400 });
    }

    if (hasRatingField || hasSlopeField) {
      const ratingPatch = {
        ...(hasRatingField ? { course_rating: courseRating } : {}),
        ...(hasSlopeField ? { slope_rating: slopeRating } : {}),
      };
      const { error: ratingError } = await supabase
        .from('golf_rounds')
        .update(ratingPatch)
        .eq('id', roundId);
      if (ratingError) {
        console.error('PATCH /api/golf/rounds/[id] rating update error:', ratingError);
        return NextResponse.json({ error: 'Failed to save course rating' }, { status: 500 });
      }
      // Mirror safety: mirrorCompletedRound re-runs on late score edits and
      // upserts golf_rounds FROM golf_scorecard_data — a backfill written
      // only to golf_rounds would be wiped by the next re-mirror. Group-rail
      // rounds must carry the ratings on the scorecard row too. (Ownership is
      // established above; scorecard_data is keyed by the group post.)
      if (round.group_post_id) {
        const { error: scError } = await supabase
          .from('golf_scorecard_data')
          .update(ratingPatch)
          .eq('group_post_id', round.group_post_id);
        if (scError) {
          console.error('PATCH /api/golf/rounds/[id] scorecard rating update error:', scError);
          return NextResponse.json({ error: 'Failed to save course rating' }, { status: 500 });
        }
      }
    }

    if (!Array.isArray(holes) || holes.length === 0) {
      // Rating-only edit — return the fresh round without touching holes.
      const { data: updated } = await supabase
        .from('golf_rounds')
        .select(`
          id, profile_id, date, course, course_location, tee, holes, round_type,
          par, gross_score, total_putts, fir_percentage, gir_percentage,
          weather, temperature, wind, course_rating, slope_rating, notes,
          is_complete, created_at,
          golf_holes (
            hole_number, par, strokes, putts, fairway_hit,
            green_in_regulation, distance_yards, notes
          )
        `)
        .eq('id', roundId)
        .single();
      updated?.golf_holes?.sort(
        (a: { hole_number: number }, b: { hole_number: number }) => a.hole_number - b.hole_number
      );
      return NextResponse.json({ round: updated, statsRecalculated: false });
    }

    // Validate each hole payload strictly — this endpoint writes score data.
    const records = [];
    for (const h of holes) {
      const holeNumber = Number(h?.hole_number);
      const strokes = Number(h?.strokes);
      if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18) {
        return NextResponse.json({ error: `Invalid hole_number: ${h?.hole_number}` }, { status: 400 });
      }
      if (!Number.isInteger(strokes) || strokes < 1 || strokes > 20) {
        return NextResponse.json({ error: `Invalid strokes for hole ${holeNumber}` }, { status: 400 });
      }
      const putts = h?.putts === null || h?.putts === undefined || h?.putts === '' ? null : Number(h.putts);
      if (putts !== null && (!Number.isInteger(putts) || putts < 0 || putts > 10)) {
        return NextResponse.json({ error: `Invalid putts for hole ${holeNumber}` }, { status: 400 });
      }
      const par = h?.par === null || h?.par === undefined ? null : Number(h.par);
      if (par !== null && (!Number.isInteger(par) || par < 3 || par > 6)) {
        return NextResponse.json({ error: `Invalid par for hole ${holeNumber}` }, { status: 400 });
      }

      records.push({
        round_id: roundId,
        hole_number: holeNumber,
        strokes,
        putts,
        ...(par !== null ? { par } : {}),
        fairway_hit: typeof h?.fairway_hit === 'boolean' ? h.fairway_hit : null,
        // null, not false — the column is nullable and null means "not
        // tracked"; coercing to false turned every save into recorded misses.
        green_in_regulation: typeof h?.green_in_regulation === 'boolean' ? h.green_in_regulation : null,
      });
    }

    // Upsert on (round_id, hole_number) — the schema's UNIQUE constraint
    const { error: upsertError } = await supabase
      .from('golf_holes')
      .upsert(records, { onConflict: 'round_id,hole_number' });

    if (upsertError) {
      console.error('PATCH /api/golf/rounds/[id] upsert error:', upsertError);
      return NextResponse.json({ error: 'Failed to save hole scores' }, { status: 500 });
    }

    // Recalculate cached round stats
    const { error: statsError } = await supabase.rpc('calculate_round_stats', { round_uuid: roundId });
    if (statsError) {
      console.error('PATCH /api/golf/rounds/[id] stats recalc error:', statsError);
      // Holes saved; stats stale until next recalc — report but don't fail the save
    }

    // Return the fresh round
    const { data: updated } = await supabase
      .from('golf_rounds')
      .select(`
        id, profile_id, date, course, course_location, tee, holes, round_type,
        par, gross_score, total_putts, fir_percentage, gir_percentage,
        weather, temperature, wind, course_rating, slope_rating, notes,
        is_complete, created_at,
        course_info:golf_courses (
          id, name, city, region, lat, lng, description, description_attribution,
          architect, year_built, course_type, website
        ),
        golf_holes (
          hole_number, par, strokes, putts, fairway_hit,
          green_in_regulation, distance_yards, notes
        )
      `)
      .eq('id', roundId)
      .single();

    updated?.golf_holes?.sort(
      (a: { hole_number: number }, b: { hole_number: number }) => a.hole_number - b.hole_number
    );

    return NextResponse.json({ round: updated, statsRecalculated: !statsError });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('PATCH /api/golf/rounds/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── DELETE /api/golf/rounds/[roundId] ─────────────────────────────────────────
// Owner-only. golf_holes cascade; posts.round_id is ON DELETE SET NULL, so
// any post that referenced this round survives without its scorecard.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ roundId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const supabase = getSupabaseAdmin();
    const { roundId } = await params;

    if (!UUID_RE.test(roundId)) {
      return NextResponse.json({ error: 'Round not found' }, { status: 404 });
    }

    const { data: round } = await supabase
      .from('golf_rounds')
      .select('id, profile_id')
      .eq('id', roundId)
      .maybeSingle();

    if (!round) {
      return NextResponse.json({ error: 'Round not found' }, { status: 404 });
    }
    if (round.profile_id !== user.id) {
      return NextResponse.json({ error: 'Only the round owner can delete it' }, { status: 403 });
    }

    const { error: deleteError } = await supabase
      .from('golf_rounds')
      .delete()
      .eq('id', roundId);

    if (deleteError) {
      console.error('DELETE /api/golf/rounds/[id] error:', deleteError);
      return NextResponse.json({ error: 'Failed to delete round' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('DELETE /api/golf/rounds/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
