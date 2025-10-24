import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Helper function for cookie authentication (Next.js 15 pattern)
function createSupabaseClient(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          const cookieHeader = request.headers.get('cookie');
          if (!cookieHeader) return undefined;
          const cookies = Object.fromEntries(
            cookieHeader.split('; ').map(cookie => {
              const [key, value] = cookie.split('=');
              return [key, decodeURIComponent(value)];
            })
          );
          return cookies[name];
        },
      },
    }
  );
}

/**
 * POST /api/golf/scorecards/[id]/scores
 * Add or update golf scores for a participant
 * [id] is the participant_id from group_post_participants table
 * Body:
 *   - scores: Array of { hole_number, strokes, putts?, fairway_hit?, green_in_regulation? }
 *   - entered_by: UUID of who is entering (optional, defaults to current user)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = createSupabaseClient(request);

  // Verify authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id: participant_id } = await params;
    const body = await request.json();
    const { scores, entered_by } = body;

    // Validate scores array
    if (!scores || !Array.isArray(scores) || scores.length === 0) {
      return NextResponse.json(
        { error: 'scores must be a non-empty array' },
        { status: 400 }
      );
    }

    // Get participant details
    const { data: participant, error: participantError } = await supabase
      .from('group_post_participants')
      .select(`
        *,
        group_post:group_post_id (
          id,
          type,
          creator_id
        )
      `)
      .eq('id', participant_id)
      .single();

    if (participantError || !participant) {
      return NextResponse.json({ error: 'Participant not found' }, { status: 404 });
    }

    // Verify user is participant or creator
    const isParticipant = participant.profile_id === user.id;
    const isCreator = (participant.group_post as { creator_id: string }).creator_id === user.id;

    if (!isParticipant && !isCreator) {
      return NextResponse.json(
        { error: 'Only the participant or group post creator can enter scores' },
        { status: 403 }
      );
    }

    // Verify participant has confirmed attendance
    if (participant.status !== 'confirmed') {
      return NextResponse.json(
        { error: 'Participant must confirm attendance before entering scores' },
        { status: 400 }
      );
    }

    // Create or get golf_participant_scores record
    const { data: golfParticipantScore, error: participantScoreError } = await supabase
      .from('golf_participant_scores')
      .select('id')
      .eq('participant_id', participant_id)
      .single();

    let golf_participant_id: string;

    if (participantScoreError && participantScoreError.code === 'PGRST116') {
      // Create new golf participant score record
      const { data: newGolfParticipant, error: insertError } = await supabase
        .from('golf_participant_scores')
        .insert({
          participant_id,
          entered_by: entered_by || user.id,
          scores_confirmed: isParticipant, // Auto-confirm if entering own scores
        })
        .select('id')
        .single();

      if (insertError) {
        console.error('Error creating golf participant scores:', insertError);
        return NextResponse.json({ error: 'Failed to create golf participant scores' }, { status: 500 });
      }

      golf_participant_id = newGolfParticipant.id;
    } else if (golfParticipantScore) {
      golf_participant_id = golfParticipantScore.id;
    } else {
      console.error('Error fetching golf participant scores:', participantScoreError);
      return NextResponse.json({ error: 'Failed to fetch golf participant scores' }, { status: 500 });
    }

    // Validate and insert/update hole scores
    const validatedScores = scores.map((score: {
      hole_number: number;
      strokes: number;
      putts?: number;
      fairway_hit?: boolean;
      green_in_regulation?: boolean;
    }) => {
      const { hole_number, strokes, putts, fairway_hit, green_in_regulation } = score;

      // Validate hole_number
      if (!hole_number || hole_number < 1 || hole_number > 18) {
        throw new Error(`Invalid hole_number: ${hole_number}. Must be between 1 and 18.`);
      }

      // Validate strokes
      if (!strokes || strokes < 1 || strokes > 15) {
        throw new Error(`Invalid strokes: ${strokes}. Must be between 1 and 15.`);
      }

      // Validate putts
      if (putts !== undefined && putts !== null && (putts < 0 || putts > strokes)) {
        throw new Error(`Invalid putts: ${putts}. Must be between 0 and ${strokes}.`);
      }

      return {
        golf_participant_id,
        hole_number,
        strokes,
        putts: putts ?? null,
        fairway_hit: fairway_hit ?? null,
        green_in_regulation: green_in_regulation ?? null,
      };
    });

    // Upsert hole scores (insert or update if exists)
    const { data: insertedScores, error: scoresError } = await supabase
      .from('golf_hole_scores')
      .upsert(validatedScores, {
        onConflict: 'golf_participant_id,hole_number',
      })
      .select();

    if (scoresError) {
      console.error('Error inserting hole scores:', scoresError);
      return NextResponse.json({ error: 'Failed to insert hole scores' }, { status: 500 });
    }

    // Fetch updated participant scores (triggers will auto-calculate totals)
    const { data: updatedGolfScores, error: fetchError } = await supabase
      .from('golf_participant_scores')
      .select(`
        *,
        hole_scores:golf_hole_scores (
          hole_number,
          strokes,
          putts,
          fairway_hit,
          green_in_regulation
        )
      `)
      .eq('id', golf_participant_id)
      .single();

    if (fetchError) {
      console.error('Error fetching updated scores:', fetchError);
    }

    return NextResponse.json({
      golf_scores: updatedGolfScores,
      inserted_count: insertedScores?.length || 0,
      message: 'Golf scores saved successfully',
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid')) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Unexpected error in POST /api/golf/scorecards/[id]/scores:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/golf/scorecards/[id]/scores
 * Fetch golf scores for a participant
 * [id] is the participant_id from group_post_participants table
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = createSupabaseClient(request);

  // Verify authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id: participant_id } = await params;

    // Fetch golf participant scores with hole-by-hole data
    const { data: golfScores, error: fetchError } = await supabase
      .from('golf_participant_scores')
      .select(`
        *,
        participant:participant_id (
          id,
          profile_id,
          status,
          role,
          profile:profile_id (
            id,
            full_name,
            first_name,
            middle_name,
            last_name,
            avatar_url,
            sport,
            school
          )
        ),
        hole_scores:golf_hole_scores (
          hole_number,
          strokes,
          putts,
          fairway_hit,
          green_in_regulation,
          created_at
        )
      `)
      .eq('participant_id', participant_id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Golf scores not found for this participant' },
          { status: 404 }
        );
      }
      console.error('Error fetching golf scores:', fetchError);
      return NextResponse.json({ error: 'Failed to fetch golf scores' }, { status: 500 });
    }

    return NextResponse.json({ golf_scores: golfScores });
  } catch (error) {
    console.error('Unexpected error in GET /api/golf/scorecards/[id]/scores:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/golf/scorecards/[id]/scores
 * Confirm/update golf scores for a participant
 * Body:
 *   - scores_confirmed: boolean (optional)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = createSupabaseClient(request);

  // Verify authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id: participant_id } = await params;
    const body = await request.json();
    const { scores_confirmed } = body;

    // Get participant details
    const { data: participant, error: participantError } = await supabase
      .from('group_post_participants')
      .select('profile_id')
      .eq('id', participant_id)
      .single();

    if (participantError || !participant) {
      return NextResponse.json({ error: 'Participant not found' }, { status: 404 });
    }

    // Verify user is the participant
    if (participant.profile_id !== user.id) {
      return NextResponse.json(
        { error: 'Only the participant can confirm their own scores' },
        { status: 403 }
      );
    }

    // Update scores_confirmed
    const { data: updatedScores, error: updateError } = await supabase
      .from('golf_participant_scores')
      .update({ scores_confirmed })
      .eq('participant_id', participant_id)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating scores confirmation:', updateError);
      return NextResponse.json({ error: 'Failed to update scores confirmation' }, { status: 500 });
    }

    return NextResponse.json({
      golf_scores: updatedScores,
      message: 'Scores confirmation updated successfully',
    });
  } catch (error) {
    console.error('Unexpected error in PATCH /api/golf/scorecards/[id]/scores:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
