import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getSupabaseAdmin, getServerAuth } from '@/lib/auth-server';
import { notifyAttestation, groupPostActionUrl } from '@/lib/golf/group-notifications';
import { reportRouteError } from '@/lib/observability/report';

/**
 * POST /api/group-posts/[id]/attest
 * Participant attestation - confirm, decline, or maybe for a group post
 * Body:
 *   - status: 'confirmed' | 'declined' | 'maybe' (required)
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
    const body = await request.json();
    const { status } = body;

    // Validate status
    const validStatuses = ['confirmed', 'declined', 'maybe'];
    if (!status || !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `status must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    // Check if user is a participant in this group post
    const { data: participant, error: participantError } = await supabase
      .from('group_post_participants')
      .select('*')
      .eq('group_post_id', id)
      .eq('profile_id', user.id)
      .single();

    if (participantError || !participant) {
      return NextResponse.json(
        { error: 'You are not a participant in this group post' },
        { status: 404 }
      );
    }

    // Results-kept round (241, Tom: "I don't want users to remove stats if they
    // played bad"): declining pulls a player off the leaderboard and out of the
    // mirror, so it is refused on an EVENT round (the event's own withdraw
    // applies) and once the player has recorded any score (hide it instead).
    if (status === 'declined') {
      const admin = getSupabaseAdmin();
      const [{ data: gp }, { data: sc }] = await Promise.all([
        admin.from('group_posts').select('sport_event_round_id').eq('id', id).maybeSingle(),
        admin.from('golf_participant_scores').select('holes_completed, total_score').eq('participant_id', participant.id).maybeSingle(),
      ]);
      if (gp?.sport_event_round_id) {
        return NextResponse.json({ error: 'This round belongs to an event — withdraw from the event instead.' }, { status: 409 });
      }
      if (sc && ((sc.holes_completed ?? 0) > 0 || sc.total_score != null)) {
        return NextResponse.json({ error: 'You already have scores on this round, so it stays on the record. You can hide it from your profile.' }, { status: 409 });
      }
    }

    // Update participant status
    const updates: Record<string, unknown> = {
      status,
    };

    // Set attested_at timestamp for confirmed status
    if (status === 'confirmed') {
      updates.attested_at = new Date().toISOString();
    } else if (status === 'declined') {
      // Clear attestation timestamp if declining
      updates.attested_at = null;
    }

    const { data: updatedParticipant, error: updateError } = await supabase
      .from('group_post_participants')
      .update(updates)
      .eq('group_post_id', id)
      .eq('profile_id', user.id)
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
      .single();

    if (updateError) {
      reportRouteError('Error updating participant status:', updateError);
      return NextResponse.json({ error: 'Failed to update attestation status' }, { status: 500 });
    }

    // Notify the round creator (best-effort)
    {
      const admin = getSupabaseAdmin();
      const { data: groupPost } = await admin
        .from('group_posts')
        .select('creator_id, title')
        .eq('id', id)
        .maybeSingle();
      if (groupPost) {
        await notifyAttestation(
          {
            supabase: admin,
            groupPostId: id,
            title: groupPost.title || 'Shared round',
            actionUrl: await groupPostActionUrl(admin, id, groupPost.creator_id),
          },
          groupPost.creator_id,
          user.id,
          status as 'confirmed' | 'declined' | 'maybe'
        );
      }
    }

    // Fetch updated group post for context
    const { data: groupPost } = await supabase
      .from('group_posts')
      .select(`
        id,
        type,
        title,
        date,
        creator:creator_id (
          id,
          full_name,
          first_name,
          middle_name,
          last_name,
          avatar_url
        )
      `)
      .eq('id', id)
      .single();

    return NextResponse.json({
      participant: updatedParticipant,
      group_post: groupPost,
      message: `Participation status updated to ${status}`,
    });
  } catch (error) {
    reportRouteError('Unexpected error in POST /api/group-posts/[id]/attest:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/group-posts/[id]/attest
 * Get current user's attestation status for a group post
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

    // Fetch participant record
    const { data: participant, error: participantError } = await supabase
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
      .eq('profile_id', user.id)
      .single();

    if (participantError || !participant) {
      return NextResponse.json(
        { error: 'You are not a participant in this group post' },
        { status: 404 }
      );
    }

    return NextResponse.json({ participant });
  } catch (error) {
    reportRouteError('Unexpected error in GET /api/group-posts/[id]/attest:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
