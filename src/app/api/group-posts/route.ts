import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getSupabaseAdmin, getServerAuth } from '@/lib/auth-server';
import { notifyGroupInvites } from '@/lib/golf/group-notifications';
import { initialRoundStatus } from '@/lib/golf/round-status';
import { parseComposition } from '@/lib/golf/course-sections';
import { GROUP_TYPE_TO_SPORT, GROUP_POST_TYPES, type GroupPostType } from '@/types/group-posts';

/**
 * GET /api/group-posts
 * Fetch group posts for the authenticated user (created or participating)
 * Query params:
 *   - type: Filter by activity type (golf_round, hockey_game, etc.)
 *   - status: Filter by status (pending, active, completed, cancelled)
 *   - limit: Number of results (default 20)
 *   - cursor: Pagination cursor (created_at timestamp)
 */
export async function GET(request: NextRequest) {
  // Verify authentication
  const { supabase, user, error: authError } = await getServerAuth(request);
  if (authError || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  // Parse query parameters
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const status = searchParams.get('status');
  const limit = parseInt(searchParams.get('limit') || '20', 10);
  const cursor = searchParams.get('cursor');

  try {
    // Build query - RLS will filter to user's accessible posts
    let query = supabase
      .from('group_posts')
      .select(`
        *,
        creator:creator_id (
          id,
          full_name,
          first_name,
          middle_name,
          last_name,
          avatar_url,
          sport,
          school
        ),
        participants:group_post_participants (
          id,
          profile_id,
          status,
          role,
          attested_at,
          data_contributed
        )
      `)
      .order('created_at', { ascending: false })
      .limit(limit);

    // Apply filters
    if (type) {
      query = query.eq('type', type);
    }
    if (status) {
      query = query.eq('status', status);
    }
    if (cursor) {
      query = query.lt('created_at', cursor);
    }

    const { data: groupPosts, error: fetchError } = await query;

    if (fetchError) {
      console.error('Error fetching group posts:', fetchError);
      return NextResponse.json({ error: 'Failed to fetch group posts' }, { status: 500 });
    }

    return NextResponse.json({
      group_posts: groupPosts || [],
      has_more: groupPosts && groupPosts.length === limit,
      next_cursor: groupPosts && groupPosts.length > 0
        ? groupPosts[groupPosts.length - 1].created_at
        : null,
    });
  } catch (error) {
    console.error('Unexpected error in GET /api/group-posts:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/group-posts
 * Create a new group post
 * Body:
 *   - type: Activity type (required)
 *   - title: Title (required)
 *   - description: Description (optional)
 *   - date: Date of activity (required)
 *   - location: Location (optional)
 *   - visibility: public | private | participants_only (default: public)
 *   - participant_ids: Array of profile IDs to invite (optional)
 */
export async function POST(request: NextRequest) {
  // Verify authentication
  const { supabase, user, error: authError } = await getServerAuth(request);
  if (authError || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { type, title, description, date, location, visibility, participant_ids, golf_data, already_played } = body;

    // Validate required fields
    if (!type || !title || !date) {
      return NextResponse.json(
        { error: 'Missing required fields: type, title, date' },
        { status: 400 }
      );
    }

    // Acting-as (Round C): a guardian switched into their athlete creates
    // the round AS the athlete — the composer already shows the child as
    // the creator, and before this the round silently landed on the
    // PARENT's profile. Same gate as posts/comments, verbatim semantics.
    const targetProfileId =
      typeof body.targetProfileId === 'string' ? body.targetProfileId : null;
    const { resolveActingProfile } = await import('@/lib/guardian-gate');
    const gate = await resolveActingProfile(
      user.id, targetProfileId, 'You do not have permission to post to this profile'
    );
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }
    const actorId = gate.actorId;
    // Acting-as writes bypass RLS (creator_id ≠ auth.uid): the gate above
    // IS the authorization (house rule, same as posts/comments).
    const db = gate.actingAs ? getSupabaseAdmin() : supabase;

    // Optional golf scorecard payload — created here, in the SAME request as
    // the group post, so a round can never exist without its scorecard (the
    // old client-side follow-up call could fail and leave a card that renders
    // nothing). Validate-if-present keeps the contract backward compatible
    // across Vercel's rolling deploy (a stale client that doesn't send
    // golf_data degrades to the old behavior instead of erroring).
    if (golf_data !== undefined) {
      if (type !== 'golf_round') {
        return NextResponse.json(
          { error: 'golf_data is only valid for golf_round group posts' },
          { status: 400 }
        );
      }
      if (!golf_data.course_name || !golf_data.round_type || !golf_data.holes_played) {
        return NextResponse.json(
          { error: 'golf_data requires course_name, round_type, holes_played' },
          { status: 400 }
        );
      }
      if (!['outdoor', 'indoor'].includes(golf_data.round_type)) {
        return NextResponse.json(
          { error: 'golf_data.round_type must be "outdoor" or "indoor"' },
          { status: 400 }
        );
      }
      if (golf_data.holes_played < 1 || golf_data.holes_played > 18) {
        return NextResponse.json(
          { error: 'golf_data.holes_played must be between 1 and 18' },
          { status: 400 }
        );
      }
      if (golf_data.game_format !== undefined && !['stroke', 'stableford', 'match'].includes(golf_data.game_format)) {
        return NextResponse.json(
          { error: 'golf_data.game_format must be "stroke", "stableford", or "match"' },
          { status: 400 }
        );
      }
      // Per-hole course data (real pars). Optional; sanitized to the known
      // shape — bad entries are dropped rather than failing the round.
      if (golf_data.hole_data !== undefined && !Array.isArray(golf_data.hole_data)) {
        return NextResponse.json(
          { error: 'golf_data.hole_data must be an array' },
          { status: 400 }
        );
      }
    }

    // Two-nine combo (migration 125): validate-if-present, drop-to-null on
    // anything malformed — same defensive stance as hole_data below. A round
    // without its composition is still a complete round.
    const sanitizedComposition = parseComposition(golf_data?.course_composition);

    const sanitizedHoleData = Array.isArray(golf_data?.hole_data)
      ? (golf_data.hole_data as Array<{ hole?: unknown; par?: unknown; yardage?: unknown }>)
          .filter(h =>
            typeof h?.hole === 'number' && h.hole >= 1 && h.hole <= 18 &&
            typeof h?.par === 'number' && h.par >= 3 && h.par <= 6
          )
          .map(h => ({
            hole: h.hole as number,
            par: h.par as number,
            ...(typeof h.yardage === 'number' && h.yardage > 0 ? { yardage: h.yardage } : {}),
          }))
      : null;

    // Validate type against the ONE vocabulary (types/group-posts.ts) — this
    // used to be a byte-identical inline copy that sport #2 would have had to
    // update in two places.
    if (!(GROUP_POST_TYPES as readonly string[]).includes(type)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${GROUP_POST_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    // Reject non-boolean already_played (client sends true, undefined, or bust)
    if (already_played !== undefined && typeof already_played !== 'boolean') {
      return NextResponse.json(
        { error: 'already_played must be a boolean' },
        { status: 400 }
      );
    }

    // Create group post. "Already played" rounds post as completed (FINAL,
    // never LIVE); live rounds start pending and advance from score activity.
    const { data: groupPost, error: createError } = await db
      .from('group_posts')
      .insert({
        creator_id: actorId,
        type,
        title,
        description,
        date,
        location,
        visibility: visibility || 'public',
        status: initialRoundStatus(already_played),
      })
      .select()
      .single();

    if (createError) {
      console.error('Error creating group post:', createError);
      return NextResponse.json({ error: 'Failed to create group post' }, { status: 500 });
    }

    // Every step below is REQUIRED for a functioning round (creator can't
    // score without their participant row; the scorecard is what the card
    // renders; the feed post is the round's only surface). On failure, roll
    // back the group post — FK cascades remove participants + golf_data — and
    // return a real error instead of leaving a half-created, unreachable
    // round behind.
    const abortCreation = async (step: string, err: unknown) => {
      console.error(`Group post creation failed at ${step}:`, err);
      // posts.group_post_id is ON DELETE SET NULL (unlike participants /
      // golf_data, which CASCADE) — if the feed-post insert committed but its
      // response was lost, deleting group_posts alone would strand a
      // caption-only post with no scorecard. Sweep it first; a no-op for
      // failures before the feed-post step.
      const { error: postCleanupError } = await db
        .from('posts')
        .delete()
        .eq('group_post_id', groupPost.id);
      if (postCleanupError) {
        console.error('Feed-post cleanup after failed creation also failed:', postCleanupError);
      }
      const { error: cleanupError } = await db
        .from('group_posts')
        .delete()
        .eq('id', groupPost.id);
      if (cleanupError) {
        // Worst case: orphan remains; migration 033's diagnostic query finds these.
        console.error('Cleanup after failed creation also failed:', cleanupError);
      }
      return NextResponse.json(
        { error: `Failed to create the round (${step}). Nothing was saved — please try again.` },
        { status: 500 }
      );
    };

    // Creation-order positions (migration 071): the client's participant_ids
    // array IS the input order. The creator may appear anywhere in it ("Add
    // Myself" appends), or not at all (live flow, creator implicit → first).
    // Every surface orders by position, so what the creator saw while
    // building the round is what everyone sees everywhere after.
    const rawIds = Array.isArray(participant_ids) ? [...new Set(participant_ids as string[])] : [];
    if (rawIds.some(pid => !isUuid(pid))) {
      return NextResponse.json({ error: 'Invalid participant ID' }, { status: 400 });
    }
    const orderedIds = rawIds.includes(actorId) ? rawIds : [actorId, ...rawIds];
    const positionOf = (id: string) => orderedIds.indexOf(id);

    // Add creator as participant with 'creator' role
    const { error: creatorError } = await db
      .from('group_post_participants')
      .insert({
        group_post_id: groupPost.id,
        profile_id: actorId,
        role: 'creator',
        status: 'confirmed', // Creator is auto-confirmed
        attested_at: new Date().toISOString(),
        position: positionOf(actorId),
      });

    if (creatorError) {
      // Fatal: a round whose creator isn't a participant breaks score entry
      // and the lifecycle machine.
      return abortCreation('creator participant', creatorError);
    }

    // Add invited participants if provided. AUTO-CONFIRMED (July 24 product
    // decision): anyone invited can score immediately — the attestation step
    // is retired (its UI never shipped and it dead-ended invitees at
    // 'pending', which the scores API rejected).
    //
    // Dedupe and DROP THE CREATOR: the modal's "Add yourself" button puts
    // the creator into participant_ids, but the creator row was already
    // inserted above — re-inserting hits UNIQUE(group_post_id, profile_id)
    // and aborted EVERY round created via that button (found in the July 25
    // two-phone test).
    const inviteeIds = rawIds.filter(id => id !== actorId);
    if (inviteeIds.length > 0) {
      const participantInserts = inviteeIds.map((profile_id: string) => ({
        group_post_id: groupPost.id,
        profile_id,
        role: 'participant',
        status: 'confirmed', // auto-confirm (see comment above)
        attested_at: new Date().toISOString(),
        position: positionOf(profile_id),
      }));

      const { error: participantsError } = await db
        .from('group_post_participants')
        .insert(participantInserts);

      if (participantsError) {
        // Fatal: "players carry through the round" is the product contract,
        // and there is no post-creation UI to re-add missing players.
        return abortCreation('participants', participantsError);
      }
    }

    // Golf scorecard data — same-request so the round and its scorecard are
    // atomic (see validation above).
    if (type === 'golf_round' && golf_data !== undefined) {
      const { error: golfDataError } = await db
        .from('golf_scorecard_data')
        .insert({
          group_post_id: groupPost.id,
          course_name: golf_data.course_name,
          // Null-guard, don't trust: course_id gained an FK to golf_courses
          // (migration 100), so a stray non-UUID (e.g. a `history-*` id)
          // would fail the ATOMIC round create. A bad link is droppable; the
          // round is not. (A well-formed UUID pointing at a deleted catalog
          // row could still trip the FK, but catalog rows are never deleted
          // in practice — accepted.)
          course_id:
            typeof golf_data.course_id === 'string' &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(golf_data.course_id)
              ? golf_data.course_id
              : null,
          round_type: golf_data.round_type,
          hole_data: sanitizedHoleData && sanitizedHoleData.length > 0 ? sanitizedHoleData : null,
          ...(golf_data.game_format !== undefined ? { game_format: golf_data.game_format } : {}),
          holes_played: golf_data.holes_played,
          tee_color: golf_data.tee_color ?? null,
          slope_rating: golf_data.slope_rating ?? null,
          course_rating: golf_data.course_rating ?? null,
          weather_conditions: golf_data.weather_conditions ?? null,
          temperature: golf_data.temperature ?? null,
          wind_speed: golf_data.wind_speed ?? null,
          course_composition: sanitizedComposition,
        });

      if (golfDataError) {
        return abortCreation('scorecard', golfDataError);
      }
    }

    // Create the FEED post that carries this group post. group_posts has no
    // feed surface of its own — without this row, shared rounds never appear
    // anywhere (the feed renders posts, and GET /api/posts attaches the
    // group scorecard via posts.group_post_id).
    //
    // DELIBERATE EXCEPTION (decided Aug 20 2026, recorded in DEVLOG): this
    // insert takes the DB default status='published' even when the creator
    // is a SUPERVISED child — shared rounds are scored live with other
    // players, so holding the feed post for guardian approval is unworkable.
    // The approvals page names this carve-out. Every other supervised write
    // goes through the pending pipeline; do not "fix" this without a product
    // decision.
    const { data: feedPost, error: feedPostError } = await db
      .from('posts')
      .insert({
        profile_id: actorId,
        // Attribution (090): a guardian created this round as their athlete —
        // the byline names the human author, same as posts and comments.
        ...(gate.actingAs ? { created_by_user_id: user.id } : {}),
        sport_key: GROUP_TYPE_TO_SPORT[type as GroupPostType] ?? 'general',
        caption: description || title,
        visibility: visibility || 'public',
        group_post_id: groupPost.id,
        // Participants ARE the tags: everyone in a shared round appears on
        // each other's Tagged tab. posts.tags only — no post_tags rows, so
        // no 'tag' notification next to the group_invite one.
        tags: inviteeIds,
        hashtags: [],
        likes_count: 0,
        comments_count: 0,
      })
      .select('id')
      .single();

    if (feedPostError || !feedPost) {
      // Fatal: without the feed post the round is reachable by NOBODY.
      return abortCreation('feed post', feedPostError);
    }

    // Reverse link (round → its feed post): the resume banner and an RLS
    // clause read it. Best-effort — posts.group_post_id is the primary link.
    let { error: linkError } = await db
      .from('group_posts')
      .update({ post_id: feedPost.id })
      .eq('id', groupPost.id);
    if (linkError) {
      // One retry: this is a single-row update by primary key, so the realistic
      // failure is a transient connection blip rather than anything a second
      // attempt would repeat.
      console.error('Failed to backfill group_posts.post_id, retrying:', linkError);
      ({ error: linkError } = await db
        .from('group_posts')
        .update({ post_id: feedPost.id })
        .eq('id', groupPost.id));
      if (linkError) {
        console.error('Backfill of group_posts.post_id failed twice:', linkError);
      }
    }

    // Notify invited participants (best-effort — the round exists regardless)
    if (inviteeIds.length > 0) {
      await notifyGroupInvites(
        {
          supabase: getSupabaseAdmin(),
          groupPostId: groupPost.id,
          title,
          actionUrl: `/athlete/${actorId}?post=${feedPost.id}`,
        },
        actorId,
        inviteeIds
      );
    }

    // Fetch complete group post with participants
    const { data: completeGroupPost, error: completeError } = await db
      .from('group_posts')
      .select(`
        *,
        creator:creator_id (
          id,
          full_name,
          first_name,
          middle_name,
          last_name,
          avatar_url,
          sport,
          school
        ),
        participants:group_post_participants (
          id,
          profile_id,
          status,
          role,
          attested_at,
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
        )
      `)
      .eq('id', groupPost.id)
      .single();

    if (completeError) {
      // Not fatal — the round and its feed post both exist, and `groupPost`
      // below is a real row. But it used to be discarded entirely, which made
      // a degraded response indistinguishable from a healthy one.
      console.error('Failed to re-fetch the created group post:', completeError);
    }

    // post_id is stamped from the value this request already knows rather than
    // read back out of the re-fetch. `groupPost` was selected BEFORE the
    // backfill above, so its post_id is structurally null; when the re-fetch
    // fails, that null used to reach the client as if it were the truth.
    return NextResponse.json({
      group_post: { ...(completeGroupPost || groupPost), post_id: feedPost.id },
      message: 'Group post created successfully',
    }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error in POST /api/group-posts:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
