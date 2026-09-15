import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { parseExpectedVersion, type HoleConflict, type HoleWrite } from '@/lib/golf/hole-writes';
import { writeHoleScores } from '@/lib/golf/hole-scores-server';
import { sanitizePenalties } from '@/lib/golf/penalties';
import { advanceRoundStatus } from '@/lib/golf/round-status';
import { mirrorCompletedRound, mirrorRoundMedia } from '@/lib/golf/round-mirror';
import { holeNumberInRange } from '@/lib/sport-events/scoring-authz';
import { reopenIfNeeded, resolveScoringRight } from '@/lib/sport-events/scoring-authz-server';

/**
 * POST /api/golf/participant-scores — the bulk creator-entered path. Body
 * `{ group_post_id, participant_scores: [{ participant_id (a PROFILE id),
 * hole_scores: [{ hole_number, strokes, …, penalties?, expected_version? }] }] }`.
 * Conflicts (phase 2b, mig 209): a hole with `expected_version` is a
 * per-hole compare-and-set; any conflict in the batch answers 409
 * `{ error, conflicts: [{ participant_id, hole_number, current }], results,
 * failures }` — the other entries' writes stand. `expected_updated_at` is
 * accepted and ignored for one release. Penalties ride only when named.
 */
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
    const admin = getSupabaseAdmin();
    const results = [];
    const failures: Array<{ participant_id: string; error: string }> = [];
    const conflicts: Array<HoleConflict & { participant_id: string }> = [];
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

      // Who may write this card, and on which client (Events program, PR 6)
      // — the same gate as the single-card route. A refusal is a named
      // failure for THIS entry, never a silent skip and never a batch 500.
      const resolved = await resolveScoringRight(admin, user.id, participantRecordId);
      if (!resolved.ok) {
        failures.push({ participant_id, error: resolved.error });
        continue;
      }
      const ctx = resolved.ctx;
      if (!ctx.right.allowed) {
        failures.push({ participant_id, error: ctx.right.error });
        continue;
      }
      const db = ctx.right.client === 'admin' ? admin : supabase;

      // Filter out holes without strokes; a hole outside the round's range
      // fails the entry by name.
      const validHoleScores = hole_scores.filter((hole: { strokes?: number }) =>
        hole.strokes !== undefined && hole.strokes > 0
      );
      const outOfRange = validHoleScores.find((hole: { hole_number?: unknown }) => typeof hole.hole_number !== 'number' || !holeNumberInRange(hole.hole_number, ctx.range.startingHole, ctx.range.holesPlayed));
      if (outOfRange) {
        failures.push({ participant_id, error: `Invalid hole_number: ${String((outOfRange as { hole_number?: unknown }).hole_number)}. This round plays holes ${ctx.range.startingHole}–${ctx.range.startingHole + ctx.range.holesPlayed - 1}.` });
        continue;
      }
      await reopenIfNeeded(admin, ctx);

      if (validHoleScores.length === 0) {
        continue; // Skip if no valid scores
      }

      // Reuse-or-create the golf_participant_scores record (the scorecards
      // route's pattern). This batch used to blind-insert and silently
      // `continue` on the 23505 — a RETRY after a partial failure dropped
      // every already-saved participant without a trace.
      let golfParticipantId: string | null = null;
      const { data: existingRecord } = await db
        .from('golf_participant_scores')
        .select('id')
        .eq('participant_id', participantRecordId)
        .maybeSingle();
      if (existingRecord) {
        golfParticipantId = existingRecord.id;
      } else {
        const { data: created, error: scoreError } = await db
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
          const { data: raced } = await db
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

      // The hole writes. NOTE: golf_hole_scores has no par/distance_yards
      // columns (verified against the live schema) — including them made
      // every insert fail with 42703 and silently discarded all
      // creator-entered scores. `?? null` not `||`: false is a TRACKED miss
      // and 0 putts is a real value. Penalties are LENIENT on this bulk
      // path (unknown types dropped, not fatal) and ride only when the
      // hole names them (209). A bad expected_version fails THIS entry.
      let badVersion: string | null = null;
      const holeWrites: HoleWrite[] = [];
      for (const hole of validHoleScores as Array<{ hole_number: number; strokes: number; putts?: number; fairway_hit?: boolean; green_in_regulation?: boolean; penalties?: unknown; expected_version?: unknown }>) {
        const expected = parseExpectedVersion(hole.expected_version);
        if (expected === null) {
          badVersion = `Invalid expected_version on hole ${hole.hole_number}`;
          break;
        }
        const w: HoleWrite = { hole_number: hole.hole_number, strokes: hole.strokes, putts: hole.putts ?? null, fairway_hit: hole.fairway_hit ?? null, green_in_regulation: hole.green_in_regulation ?? null };
        if (Object.prototype.hasOwnProperty.call(hole, 'penalties')) w.penalties = sanitizePenalties(hole.penalties);
        if (expected !== undefined) w.expected_version = expected;
        holeWrites.push(w);
      }
      if (badVersion) {
        failures.push({ participant_id, error: badVersion });
        continue;
      }

      if (!golfParticipantId) {
        failures.push({ participant_id, error: 'Could not create score record' });
        continue;
      }

      // Unchecked writes UPSERT (a retry or a re-submit of the same scorecard
      // updates in place); checked writes are the per-hole compare-and-set.
      const outcome = await writeHoleScores(db, golfParticipantId, holeWrites);
      for (const c of outcome.conflicts) conflicts.push({ participant_id, ...c });
      if (outcome.error) {
        failures.push({ participant_id, error: outcome.error });
      } else if (outcome.written > 0 || outcome.conflicts.length === 0) {
        results.push({
          participant_id,
          score_record_id: golfParticipantId,
          holes_entered: outcome.written
        });
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

    if (conflicts.length > 0) {
      return NextResponse.json({
        error: 'Someone else scored a hole since you last saw it.',
        conflicts,
        results,
        failures,
      }, { status: 409 });
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
