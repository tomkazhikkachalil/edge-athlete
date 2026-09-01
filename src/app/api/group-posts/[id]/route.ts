import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { toProxyUrl } from '@/lib/media/proxy-url';
import { deleteRoundCascade } from '@/lib/golf/round-delete-server';
import { mirrorCompletedRound, mirrorRoundMedia } from '@/lib/golf/round-mirror';

/**
 * GET /api/group-posts/[id]
 * Fetch a specific group post with all details
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

    // Fetch group post with all related data - RLS handles access control
    const { data: groupPost, error: fetchError } = await supabase
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
          data_contributed,
          last_contribution,
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
        media:group_post_media (
          id,
          media_url,
          media_type,
          caption,
          position,
          uploaded_by,
          created_at,
          segment_number,
          segment_kind,
          thumbnail_url,
          duration_seconds
        )
      `)
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Group post not found' }, { status: 404 });
      }
      console.error('Error fetching group post:', fetchError);
      return NextResponse.json({ error: 'Failed to fetch group post' }, { status: 500 });
    }

    // Proxy round media bytes (governed by the group rule; id = group post id).
    const gp = groupPost as { media?: Array<{ media_url: string; thumbnail_url: string | null }> };
    if (Array.isArray(gp.media)) {
      gp.media = gp.media.map(m => ({
        ...m,
        media_url: toProxyUrl(m.media_url, { type: 'group', id }) ?? m.media_url,
        thumbnail_url: toProxyUrl(m.thumbnail_url, { type: 'group', id }),
      }));
    }
    return NextResponse.json({ group_post: groupPost });
  } catch (error) {
    console.error('Unexpected error in GET /api/group-posts/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/group-posts/[id]
 * Update a group post (only creator can update)
 * Body: Partial group post fields (title, description, date, location, visibility, status)
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
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'Invalid group post ID' }, { status: 400 });
    }
    const body = await request.json();

    // Extract allowed fields
    const { title, description, date, location, visibility, status } = body;

    // Validate status up front — otherwise the DB CHECK constraint rejects it
    // as an opaque 500 instead of a clear 400.
    const validStatuses = ['pending', 'active', 'completed', 'cancelled'];
    if (status !== undefined && !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    // Prior status — needed to bump the feed post's timestamp exactly once
    // on the transition to completed (End Round)
    let priorStatus: string | null = null;
    if (status === 'completed') {
      const { data: prior } = await supabase
        .from('group_posts')
        .select('status')
        .eq('id', id)
        .maybeSingle();
      priorStatus = prior?.status ?? null;
    }

    // Build update object
    const updates: Record<string, unknown> = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (date !== undefined) updates.date = date;
    if (location !== undefined) updates.location = location;
    if (visibility !== undefined) updates.visibility = visibility;
    if (status !== undefined) updates.status = status;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    // Update group post - RLS will ensure only creator can update
    const { data: updatedGroupPost, error: updateError } = await supabase
      .from('group_posts')
      .update(updates)
      .eq('id', id)
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
          data_contributed,
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
      .single();

    if (updateError) {
      console.error('Error updating group post:', updateError);
      return NextResponse.json({ error: 'Failed to update group post' }, { status: 500 });
    }

    // End Round: a round marked completed mirrors every player's scores into
    // golf_rounds (stats/trends/handicap). Best-effort, self-gated.
    if (status === 'completed') {
      const admin = getSupabaseAdmin();
      await mirrorCompletedRound(admin, id);
      // Hole photos/videos land in the feed post too — without this the
      // finished post shows stats and no pictures.
      await mirrorRoundMedia(admin, id);

      // One-time transition: the round's hidden-while-live feed post arrives
      // in the feed now, timestamped at completion
      if (priorStatus !== 'completed') {
        const { error: bumpError } = await admin
          .from('posts')
          .update({ created_at: new Date().toISOString() })
          .eq('group_post_id', id);
        if (bumpError) {
          console.error('End Round: post timestamp bump failed:', bumpError);
        }
      }
    }

    return NextResponse.json({
      group_post: updatedGroupPost,
      message: 'Group post updated successfully',
    });
  } catch (error) {
    console.error('Unexpected error in PATCH /api/group-posts/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/group-posts/[id]
 * Delete a round completely (creator only): group post + children (cascade),
 * the linked feed post (storage-safe), and the golf_rounds stat mirrors —
 * via the shared deleteRoundCascade. The previous version deleted through
 * the RLS client without checking the row count, so an RLS refusal reported
 * success while deleting nothing — and it left the feed post and mirrors
 * behind. It also had no callers; the live-round Delete button is the first.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Verify authentication
  const { user, error: authError } = await getServerAuth(request);
  if (authError || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'Invalid group post ID' }, { status: 400 });
    }
    const result = await deleteRoundCascade(getSupabaseAdmin(), id, user.id);

    switch (result.status) {
      case 'deleted':
        return NextResponse.json({ message: 'Round deleted successfully' });
      case 'not_found':
        return NextResponse.json({ error: 'Round not found' }, { status: 404 });
      case 'forbidden':
        return NextResponse.json(
          { error: 'Only the round creator can delete it' },
          { status: 403 }
        );
      case 'error':
        return NextResponse.json({ error: result.message }, { status: 500 }); // hardening-ok: crafted strings, see round-delete-server.ts
    }
  } catch (error) {
    console.error('Unexpected error in DELETE /api/group-posts/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
