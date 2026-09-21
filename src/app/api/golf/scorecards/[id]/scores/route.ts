import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getSupabaseAdmin, getServerAuth } from '@/lib/auth-server';
import { notifyScoresPosted, groupPostActionUrl } from '@/lib/golf/group-notifications';
import { parseExpectedVersion, type HoleWrite } from '@/lib/golf/hole-writes';
import { writeHoleScores } from '@/lib/golf/hole-scores-server';
import { validatePenalties } from '@/lib/golf/penalties';
import { advanceRoundStatus } from '@/lib/golf/round-status';
import { mirrorCompletedRound, mirrorRoundMedia } from '@/lib/golf/round-mirror';
import { holeNumberInRange } from '@/lib/sport-events/scoring-authz';
import { reopenIfNeeded, resolveScoringRight } from '@/lib/sport-events/scoring-authz-server';
import { reportRouteError } from '@/lib/observability/report';

/**
 * POST /api/golf/scorecards/[id]/scores
 * Add or update golf scores for a participant
 * [id] is the participant_id from group_post_participants table
 * Body:
 *   - scores: Array of { hole_number, strokes, putts?, fairway_hit?,
 *     green_in_regulation?, penalties?, expected_version? }
 *   - entered_by is always the session user (never body-supplied)
 *
 * Conflicts (phase 2b, mig 209): a score that carries `expected_version`
 * is a per-hole compare-and-set — 0 = "I saw no score" (insert), n = the
 * row must still be at n (update WHERE version = n). Any conflict → 409
 * `{ error, conflicts: [{ hole_number, current }] }` with the hole's
 * current row; the client decides (keep mine = resend with
 * current.version). A score without `expected_version` is unchecked
 * (last writer wins — old clients). `expected_updated_at` (the card-stamp
 * guard this replaced) is accepted and ignored for one release.
 * Penalties ride only when the body names them: an absent key leaves the
 * stored penalties alone, `[]` / null clears them.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Verify authentication
  const { supabase, user, error: authError } = await getServerAuth(request);
  if (authError || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { id: participant_id } = await params;
    if (!isUuid(participant_id)) {
      return NextResponse.json({ error: 'Invalid participant ID' }, { status: 400 });
    }
    const body = await request.json();
    const { scores } = body; // entered_by is always the session user

    // Validate scores array
    if (!scores || !Array.isArray(scores) || scores.length === 0) {
      return NextResponse.json(
        { error: 'scores must be a non-empty array' },
        { status: 400 }
      );
    }

    // Who may write this card, and on which client (Events program, PR 6):
    // the participant and the round's creator on the session client (RLS,
    // mig 200); a same-group partner or an organizer of the round's EVENT on
    // the admin client — the gate IS the authorization. A submitted card
    // refuses a partner and reopens for its owner; a final card is the
    // organizer's. Old clients see exactly the old behaviour.
    const admin = getSupabaseAdmin();
    const resolved = await resolveScoringRight(admin, user.id, participant_id);
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    const ctx = resolved.ctx;
    if (!ctx.right.allowed) return NextResponse.json({ error: ctx.right.error }, { status: ctx.right.status });
    const db = ctx.right.client === 'admin' ? admin : supabase;
    const participant = { profile_id: ctx.participant.profile_id, status: ctx.participant.status, group_post: ctx.groupPost };
    const isParticipant = ctx.right.via === 'self';

    // Under the auto-confirm model only an explicit decline blocks score
    // entry (legacy 'pending' rows count as playing — see isActiveParticipant)
    if (participant.status === 'declined') {
      return NextResponse.json(
        { error: 'This participant declined the round' },
        { status: 400 }
      );
    }

    // Holes run from the round's starting hole (an event round knows its
    // own; a back nine is 10..18).
    for (const score of scores as Array<{ hole_number?: unknown }>) {
      if (typeof score?.hole_number !== 'number' || !holeNumberInRange(score.hole_number, ctx.range.startingHole, ctx.range.holesPlayed)) {
        return NextResponse.json({ error: `Invalid hole_number: ${String(score?.hole_number)}. This round plays holes ${ctx.range.startingHole}–${ctx.range.startingHole + ctx.range.holesPlayed - 1}.` }, { status: 400 });
      }
    }
    await reopenIfNeeded(admin, ctx);

    // Create or get golf_participant_scores record
    const { data: golfParticipantScore, error: participantScoreError } = await db
      .from('golf_participant_scores')
      .select('id')
      .eq('participant_id', participant_id)
      .single();

    let golf_participant_id: string;

    if (participantScoreError && participantScoreError.code === 'PGRST116') {
      // Create new golf participant score record
      const { data: newGolfParticipant, error: insertError } = await db
        .from('golf_participant_scores')
        .insert({
          participant_id,
          entered_by: user.id, // session user — body-supplied entered_by could forge attribution
          scores_confirmed: isParticipant, // Auto-confirm if entering own scores
        })
        .select('id')
        .single();

      if (insertError?.code === '23505') {
        // Lost a first-save race: the keepalive flush (pagehide/visibility)
        // can land concurrently with the foreground save, both see no row,
        // both insert, the loser hits UNIQUE(participant_id). The row exists
        // now — use it rather than failing a save that must block navigation.
        const { data: raced, error: racedError } = await db
          .from('golf_participant_scores')
          .select('id')
          .eq('participant_id', participant_id)
          .single();
        if (racedError || !raced) {
          reportRouteError('Error resolving raced golf participant scores:', racedError);
          return NextResponse.json({ error: 'Failed to create golf participant scores' }, { status: 500 });
        }
        golf_participant_id = raced.id;
      } else if (insertError || !newGolfParticipant) {
        reportRouteError('Error creating golf participant scores:', insertError);
        return NextResponse.json({ error: 'Failed to create golf participant scores' }, { status: 500 });
      } else {
        golf_participant_id = newGolfParticipant.id;
      }
    } else if (golfParticipantScore) {
      golf_participant_id = golfParticipantScore.id;
    } else {
      reportRouteError('Error fetching golf participant scores:', participantScoreError);
      return NextResponse.json({ error: 'Failed to fetch golf participant scores' }, { status: 500 });
    }

    // Penalties: STRICT vocabulary check per score — an unknown type rejects
    // the batch with the validator's message (400), it is never silently
    // dropped on this path (the bulk creator path sanitizes instead). A
    // score WITHOUT the key leaves the stored penalties alone (209).
    const penaltiesByIndex: Array<string[] | null | undefined> = [];
    for (const score of scores as Array<{ penalties?: unknown }>) {
      if (!Object.prototype.hasOwnProperty.call(score, 'penalties')) {
        penaltiesByIndex.push(undefined);
        continue;
      }
      const validated = validatePenalties(score.penalties);
      if (validated !== null && !Array.isArray(validated)) {
        return NextResponse.json({ error: validated.error }, { status: 400 });
      }
      penaltiesByIndex.push(validated);
    }
    const expectedByIndex: Array<number | undefined> = [];
    for (const score of scores as Array<{ hole_number: number; expected_version?: unknown }>) {
      const expected = parseExpectedVersion(score.expected_version);
      if (expected === null) return NextResponse.json({ error: `Invalid expected_version on hole ${score.hole_number}: a whole number, 0 for a hole you saw unscored.` }, { status: 400 });
      expectedByIndex.push(expected);
    }

    // Validate and insert/update hole scores
    const validatedScores: HoleWrite[] = scores.map((score: {
      hole_number: number;
      strokes: number;
      putts?: number;
      fairway_hit?: boolean;
      green_in_regulation?: boolean;
    }, index: number) => {
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

      const write: HoleWrite = {
        hole_number,
        strokes,
        putts: putts ?? null,
        fairway_hit: fairway_hit ?? null,
        green_in_regulation: green_in_regulation ?? null,
      };
      if (penaltiesByIndex[index] !== undefined) write.penalties = penaltiesByIndex[index];
      if (expectedByIndex[index] !== undefined) write.expected_version = expectedByIndex[index];
      return write;
    });

    // The per-hole compare-and-set (209): unchecked writes upsert, checked
    // writes insert / update WHERE version = expected; a conflict names the
    // hole and carries its current row.
    const outcome = await writeHoleScores(db, golf_participant_id, validatedScores);
    if (outcome.error) {
      return NextResponse.json({ error: outcome.error }, { status: 500 });
    }
    if (outcome.conflicts.length > 0) {
      return NextResponse.json({ error: 'Someone else scored this hole since you last saw it.', conflicts: outcome.conflicts, written: outcome.written }, { status: 409 });
    }

    // Fetch updated participant scores (triggers will auto-calculate totals)
    const { data: updatedGolfScores, error: fetchError } = await db
      .from('golf_participant_scores')
      .select(`
        *,
        hole_scores:golf_hole_scores (
          hole_number,
          strokes,
          putts,
          fairway_hit,
          green_in_regulation,
          penalties,
          version
        )
      `)
      .eq('id', golf_participant_id)
      .single();

    if (fetchError) {
      reportRouteError('Error fetching updated scores:', fetchError);
    }

    // Notify the creator (+ leaderboard-final fan-out when everyone has
    // scored). Best-effort — never fails the save.
    {
      const groupPostId = (participant.group_post as { id: string }).id;
      const creatorId = (participant.group_post as { creator_id: string }).creator_id;

      // Advance the round lifecycle (pending → active → completed) off this
      // score write. Best-effort like the notifications below. Runs before
      // them so the DB trigger's Realtime event → client refresh picks up the
      // new status in the same round-trip.
      await advanceRoundStatus(admin, groupPostId);
      // Cross-viewer liveness tick: every open viewer subscribes to THIS
      // round's group_posts row (server-filtered `id=eq.`), and group_posts
      // SELECT RLS has the public branch — so bumping updated_at turns each
      // hole save into a realtime event that reaches non-participant viewers
      // even where score-table events can't (subscriber RLS / publication
      // gaps). advanceRoundStatus only writes on a status TRANSITION, so
      // without this the row goes silent for the whole middle of the round.
      // No trigger loop: the 039 totals trigger touches participant tables
      // only, and nothing orders feeds by group_posts.updated_at.
      await admin
        .from('group_posts')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', groupPostId);
      // Keep the golf_rounds mirror in sync (no-op unless completed)
      await mirrorCompletedRound(admin, groupPostId);
      await mirrorRoundMedia(admin, groupPostId);
      const { data: groupMeta } = await admin
        .from('group_posts')
        .select('title')
        .eq('id', groupPostId)
        .maybeSingle();
      await notifyScoresPosted(
        {
          supabase: admin,
          groupPostId,
          title: groupMeta?.title || 'Shared round',
          actionUrl: await groupPostActionUrl(admin, groupPostId, creatorId),
        },
        creatorId,
        // Attribute to the score OWNER (entered_by is the session user, but
        // the social event is "this player's scores are in")
        participant.profile_id
      );
    }

    return NextResponse.json({
      golf_scores: updatedGolfScores,
      inserted_count: outcome.written,
      message: 'Golf scores saved successfully',
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid')) {
      // Only this file's own validation throws ("Invalid hole_number: …")
      // match — user-facing copy, not DB internals.
      return NextResponse.json({ error: error.message }, { status: 400 }); // hardening-ok
    }
    reportRouteError('Unexpected error in POST /api/golf/scorecards/[id]/scores:', error);
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
  // Verify authentication
  const { supabase, user, error: authError } = await getServerAuth(request);
  if (authError || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { id: participant_id } = await params;
    if (!isUuid(participant_id)) {
      return NextResponse.json({ error: 'Invalid participant ID' }, { status: 400 });
    }

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
          penalties,
          version,
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
      reportRouteError('Error fetching golf scores:', fetchError);
      return NextResponse.json({ error: 'Failed to fetch golf scores' }, { status: 500 });
    }

    return NextResponse.json({ golf_scores: golfScores });
  } catch (error) {
    reportRouteError('Unexpected error in GET /api/golf/scorecards/[id]/scores:', error);
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
  // Verify authentication
  const { supabase, user, error: authError } = await getServerAuth(request);
  if (authError || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { id: participant_id } = await params;
    if (!isUuid(participant_id)) {
      return NextResponse.json({ error: 'Invalid participant ID' }, { status: 400 });
    }
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
      reportRouteError('Error updating scores confirmation:', updateError);
      return NextResponse.json({ error: 'Failed to update scores confirmation' }, { status: 500 });
    }

    return NextResponse.json({
      golf_scores: updatedScores,
      message: 'Scores confirmation updated successfully',
    });
  } catch (error) {
    reportRouteError('Unexpected error in PATCH /api/golf/scorecards/[id]/scores:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
