import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { sanitizePenalties } from '@/lib/golf/penalties';
import { advanceRoundStatus } from '@/lib/golf/round-status';
import { mirrorCompletedRound, mirrorRoundMedia } from '@/lib/golf/round-mirror';

export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    const { supabase, user, error: authError } = await getServerAuth(request);
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Authentication required' },
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
    const failures: Array<{ participant_id: string; error: string }> = [];
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

      // Reuse-or-create the golf_participant_scores record (the scorecards
      // route's pattern). This batch used to blind-insert and silently
      // `continue` on the 23505 — a RETRY after a partial failure dropped
      // every already-saved participant without a trace.
      let golfParticipantId: string | null = null;
      const { data: existingRecord } = await supabase
        .from('golf_participant_scores')
        .select('id')
        .eq('participant_id', participantRecordId)
        .maybeSingle();
      if (existingRecord) {
        golfParticipantId = existingRecord.id;
      } else {
        const { data: created, error: scoreError } = await supabase
          .from('golf_participant_scores')
          .insert({
            participant_id: participantRecordId,
            entered_by: user.id,
            scores_confirmed: false
          })
          .select('id')
          .single();
        if (scoreError?.code === '23505') {
          // Lost a creation race — the row exists now; use it.
          const { data: raced } = await supabase
            .from('golf_participant_scores')
            .select('id')
            .eq('participant_id', participantRecordId)
            .maybeSingle();
          golfParticipantId = raced?.id ?? null;
        } else if (created) {
          golfParticipantId = created.id;
        }
        if (!golfParticipantId) {
          console.error('[PARTICIPANT SCORES] score record failed:', scoreError);
          failures.push({ participant_id, error: scoreError?.message || 'Could not create score record' });
          continue;
        }
      }

      // Insert hole scores
      const holeScoreRecords = validHoleScores.map((hole: {
        hole_number: number;
        strokes: number;
        putts?: number;
        fairway_hit?: boolean;
        green_in_regulation?: boolean;
        penalties?: string[] | null;
        par?: number;
        yardage?: number;
      }) => ({
        // NOTE: golf_hole_scores has no par/distance_yards columns (verified
        // against the live schema) — including them made every insert fail
        // with 42703 and silently discarded all creator-entered scores.
        golf_participant_id: golfParticipantId,
        hole_number: hole.hole_number,
        strokes: hole.strokes,
        putts: hole.putts || null,
        fairway_hit: hole.fairway_hit || null,
        green_in_regulation: hole.green_in_regulation || null,
        // LENIENT on this bulk path: unknown types are dropped, not fatal —
        // one bad entry must not discard a whole creator-entered scorecard.
        penalties: sanitizePenalties(hole.penalties)
      }));

      // UPSERT (was insert): a retry or a re-submit of the same scorecard
      // updates in place instead of failing the UNIQUE and vanishing.
      const { error: holeScoresError } = await supabase
        .from('golf_hole_scores')
        .upsert(holeScoreRecords, { onConflict: 'golf_participant_id,hole_number' });

      if (!holeScoresError) {
        results.push({
          participant_id,
          score_record_id: golfParticipantId,
          holes_entered: holeScoreRecords.length
        });
      } else {
        console.error('[PARTICIPANT SCORES] hole insert failed:', holeScoresError);
        failures.push({ participant_id, error: holeScoresError.message });
      }
    }

    // If every participant's scores failed to save, that's an error — don't
    // report success (the old behavior silently discarded all scores).
    if (results.length === 0 && failures.length > 0) {
      return NextResponse.json({
        error: 'Failed to save scores',
        failures
      }, { status: 500 });
    }

    // Advance the round lifecycle off this batch write (a full after-the-fact
    // scorecard goes straight to 'completed'; partial entry marks it 'active').
    // Best-effort — never fails the save.
    if (results.length > 0) {
      await advanceRoundStatus(getSupabaseAdmin(), group_post_id);
      // Keep the golf_rounds mirror in sync (no-op unless completed)
      await mirrorCompletedRound(getSupabaseAdmin(), group_post_id);
      await mirrorRoundMedia(getSupabaseAdmin(), group_post_id);
    }

    return NextResponse.json({
      success: true,
      results,
      failures,
      message: `Scores saved for ${results.length} participant(s)`
    });

  } catch (e) {
    console.error('POST /api/golf/participant-scores error:', e);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
