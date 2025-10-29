import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

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

export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabaseClient(request);

    // Authenticate user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { group_post_id, participant_scores } = body;

    if (!group_post_id || !participant_scores || !Array.isArray(participant_scores)) {
      return NextResponse.json(
        { error: 'Missing required fields: group_post_id, participant_scores' },
        { status: 400 }
      );
    }

    // Verify user is creator or participant of this group post
    const { data: groupPost, error: groupError } = await supabase
      .from('group_posts')
      .select('id, creator_id')
      .eq('id', group_post_id)
      .single();

    if (groupError || !groupPost) {
      return NextResponse.json(
        { error: 'Group post not found' },
        { status: 404 }
      );
    }

    const isCreator = groupPost.creator_id === user.id;

    // Get all participants for this group post
    const { data: participants, error: participantsError } = await supabase
      .from('group_post_participants')
      .select('id, profile_id')
      .eq('group_post_id', group_post_id);

    if (participantsError) {
      return NextResponse.json(
        { error: 'Failed to fetch participants' },
        { status: 500 }
      );
    }

    const participantMap = new Map(participants?.map(p => [p.profile_id, p.id]) || []);
    const isParticipant = participantMap.has(user.id);

    if (!isCreator && !isParticipant) {
      return NextResponse.json(
        { error: 'Not authorized to add scores to this group post' },
        { status: 403 }
      );
    }

    // Process each participant's scores
    const results = [];
    for (const participantScore of participant_scores) {
      const { participant_id, hole_scores } = participantScore;

      if (!participant_id || !hole_scores || !Array.isArray(hole_scores)) {
        continue; // Skip invalid entries
      }

      // Get the participant record ID from the profile ID
      const participantRecordId = participantMap.get(participant_id);
      if (!participantRecordId) {
        continue; // Skip if not a valid participant
      }

      // Only allow creator to enter scores for others, or participants to enter their own
      if (!isCreator && participant_id !== user.id) {
        continue; // Skip unauthorized score entries
      }

      // Filter out holes without strokes
      const validHoleScores = hole_scores.filter((hole: { strokes?: number }) =>
        hole.strokes !== undefined && hole.strokes > 0
      );

      if (validHoleScores.length === 0) {
        continue; // Skip if no valid scores
      }

      // Create golf_participant_scores record
      const { data: participantScoreRecord, error: scoreError } = await supabase
        .from('golf_participant_scores')
        .insert({
          participant_id: participantRecordId,
          entered_by: user.id,
          scores_confirmed: false
        })
        .select('id')
        .single();

      if (scoreError || !participantScoreRecord) {
        continue; // Skip on error
      }

      // Insert hole scores
      const holeScoreRecords = validHoleScores.map((hole: {
        hole_number: number;
        strokes: number;
        putts?: number;
        fairway_hit?: boolean;
        green_in_regulation?: boolean;
        par?: number;
        yardage?: number;
      }) => ({
        golf_participant_id: participantScoreRecord.id,
        hole_number: hole.hole_number,
        strokes: hole.strokes,
        putts: hole.putts || null,
        fairway_hit: hole.fairway_hit || null,
        green_in_regulation: hole.green_in_regulation || null,
        par: hole.par || null,
        distance_yards: hole.yardage || null
      }));

      const { error: holeScoresError } = await supabase
        .from('golf_hole_scores')
        .insert(holeScoreRecords);

      if (!holeScoresError) {
        results.push({
          participant_id,
          score_record_id: participantScoreRecord.id,
          holes_entered: holeScoreRecords.length
        });
      }
    }

    return NextResponse.json({
      success: true,
      results,
      message: `Scores saved for ${results.length} participant(s)`
    });

  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
