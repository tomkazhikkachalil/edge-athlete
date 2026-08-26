import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { syncMirrorPostTags } from '@/lib/group-posts/mirror-tags';
import { filterBlockedBidirectional } from '@/lib/blocks';
import { enforceRateLimit } from '@/lib/rate-limit';

/**
 * GET /api/group-posts/[id]/participants
 * Fetch all participants for a group post
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
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'Invalid group post ID' }, { status: 400 });
    }

    // Fetch participants - RLS handles access control
    const { data: participants, error: fetchError } = await supabase
      .from('group_post_participants')
      .select(`
        *,
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
      `)
      .eq('group_post_id', id)
      .order('created_at', { ascending: true });

    if (fetchError) {
      console.error('Error fetching participants:', fetchError);
      return NextResponse.json({ error: 'Failed to fetch participants' }, { status: 500 });
    }

    return NextResponse.json({ participants: participants || [] });
  } catch (error) {
    console.error('Unexpected error in GET /api/group-posts/[id]/participants:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/group-posts/[id]/participants
 * Add participants to a group post
 * Body:
 *   - participant_ids: Array of profile IDs to add (required)
 *   - role: Role for participants (default: 'participant')
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
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'Invalid group post ID' }, { status: 400 });
    }
    const limited = await enforceRateLimit(request, 'group-post-add', { userId: user.id });
    if (limited) return limited;

    const body = await request.json();
    const { participant_ids, role } = body;

    // Validate input
    if (!participant_ids || !Array.isArray(participant_ids) || participant_ids.length === 0) {
      return NextResponse.json(
        { error: 'participant_ids must be a non-empty array' },
        { status: 400 }
      );
    }
    if (participant_ids.some((pid: unknown) => !isUuid(typeof pid === 'string' ? pid : null))) {
      return NextResponse.json({ error: 'Invalid participant ID' }, { status: 400 });
    }

    // Verify user is creator or organizer - check group post
    const { data: groupPost, error: groupPostError } = await supabase
      .from('group_posts')
      .select('creator_id')
      .eq('id', id)
      .single();

    if (groupPostError || !groupPost) {
      return NextResponse.json({ error: 'Group post not found' }, { status: 404 });
    }

    // Check if user is creator or organizer
    const isCreator = groupPost.creator_id === user.id;
    let isOrganizer = false;

    if (!isCreator) {
      const { data: participant } = await supabase
        .from('group_post_participants')
        .select('role')
        .eq('group_post_id', id)
        .eq('profile_id', user.id)
        .single();

      isOrganizer = participant?.role === 'organizer';
    }

    if (!isCreator && !isOrganizer) {
      return NextResponse.json(
        { error: 'Only creator or organizers can add participants' },
        { status: 403 }
      );
    }

    // Block gate (hardening round, owner decision: SILENT SKIP). Anyone who
    // has a user_blocks row in either direction vs the caller is quietly
    // excluded; if EVERYONE was excluded we still return 201 with an empty
    // list — an error here would reveal the block. Response carries only a
    // count, never identities. ids are UUID-validated above.
    const { allowed: addableIds, skipped: skippedBlocked } =
      await filterBlockedBidirectional(getSupabaseAdmin(), user.id, participant_ids as string[]);
    if (addableIds.length === 0) {
      return NextResponse.json({
        participants: [],
        ...(skippedBlocked > 0 ? { skipped_blocked: skippedBlocked } : {}),
        message: 'Participants added successfully',
      }, { status: 201 });
    }

    // Late additions append to the canonical creation order (migration 071):
    // next position after the current max, in the order they're added now.
    const { data: maxRow } = await supabase
      .from('group_post_participants')
      .select('position')
      .eq('group_post_id', id)
      .order('position', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    const nextPosition = (maxRow?.position ?? -1) + 1;

    // Add participants — AUTO-CONFIRMED (same model as creation-time invites:
    // anyone invited can score immediately; only an explicit decline excludes)
    const participantInserts = addableIds.map((profile_id: string, i: number) => ({
      group_post_id: id,
      profile_id,
      role: role || 'participant',
      status: 'confirmed',
      attested_at: new Date().toISOString(),
      position: nextPosition + i,
    }));

    const { data: newParticipants, error: insertError } = await supabase
      .from('group_post_participants')
      .insert(participantInserts)
      .select(`
        *,
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
      `);

    if (insertError) {
      // Check if it's a duplicate error
      if (insertError.code === '23505') {
        return NextResponse.json(
          { error: 'One or more participants are already in this group post' },
          { status: 409 }
        );
      }
      console.error('Error adding participants:', insertError);
      return NextResponse.json({ error: 'Failed to add participants' }, { status: 500 });
    }

    // Keep the mirror post's tags in step (participants ARE the tags).
    // Best-effort: the participant insert is the primary contract.
    await syncMirrorPostTags(getSupabaseAdmin(), id);

    return NextResponse.json({
      participants: newParticipants,
      ...(skippedBlocked > 0 ? { skipped_blocked: skippedBlocked } : {}),
      message: 'Participants added successfully',
    }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error in POST /api/group-posts/[id]/participants:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/group-posts/[id]/participants
 * Remove a participant from a group post
 * Body:
 *   - participant_id: Profile ID to remove (required)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Verify authentication
  const { supabase, user, error: authError } = await getServerAuth(request);
  if (authError || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'Invalid group post ID' }, { status: 400 });
    }
    const body = await request.json();
    const { participant_id } = body;

    if (!participant_id) {
      return NextResponse.json(
        { error: 'participant_id is required' },
        { status: 400 }
      );
    }

    // Verify user is creator, organizer, or removing themselves
    const { data: groupPost } = await supabase
      .from('group_posts')
      .select('creator_id')
      .eq('id', id)
      .single();

    if (!groupPost) {
      return NextResponse.json({ error: 'Group post not found' }, { status: 404 });
    }

    const isCreator = groupPost.creator_id === user.id;
    const isRemovingSelf = participant_id === user.id;

    let isOrganizer = false;
    if (!isCreator && !isRemovingSelf) {
      const { data: participant } = await supabase
        .from('group_post_participants')
        .select('role')
        .eq('group_post_id', id)
        .eq('profile_id', user.id)
        .single();

      isOrganizer = participant?.role === 'organizer';
    }

    if (!isCreator && !isOrganizer && !isRemovingSelf) {
      return NextResponse.json(
        { error: 'Only creator, organizers, or the participant themselves can remove participants' },
        { status: 403 }
      );
    }

    // Prevent removing the creator
    if (participant_id === groupPost.creator_id) {
      return NextResponse.json(
        { error: 'Cannot remove the creator from the group post' },
        { status: 400 }
      );
    }

    // Remove participant - CASCADE will handle related data
    const { error: deleteError } = await supabase
      .from('group_post_participants')
      .delete()
      .eq('group_post_id', id)
      .eq('profile_id', participant_id);

    if (deleteError) {
      console.error('Error removing participant:', deleteError);
      return NextResponse.json({ error: 'Failed to remove participant' }, { status: 500 });
    }

    // Keep the mirror post's tags in step (participants ARE the tags).
    await syncMirrorPostTags(getSupabaseAdmin(), id);

    return NextResponse.json({
      message: 'Participant removed successfully',
    });
  } catch (error) {
    console.error('Unexpected error in DELETE /api/group-posts/[id]/participants:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
