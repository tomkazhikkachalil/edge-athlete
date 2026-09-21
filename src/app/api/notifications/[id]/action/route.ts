import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { ACTIONABLE_TYPES } from '@/lib/notification-registry';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
import { applyJoin } from '@/lib/sport-events/join-server';
import { reportRouteError } from '@/lib/observability/report';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const user = await requireAuth(request);
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'Invalid notification ID' }, { status: 400 });
    }
    const body = await request.json();
    const { action } = body;

    if (!action || !['accept', 'decline'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be "accept" or "decline"' },
        { status: 400 }
      );
    }

    // Get the notification to verify ownership and get follow_id
    const { data: notification, error: notifError } = await supabaseAdmin
      .from('notifications')
      .select('id, user_id, type, follow_id, action_status, metadata')
      .eq('id', id)
      .single();

    if (notifError || !notification) {
      reportRouteError('[NOTIFICATION ACTION] Error fetching notification:', notifError);
      return NextResponse.json(
        { error: 'Notification not found' },
        { status: 404 }
      );
    }

    // Verify ownership
    if (notification.user_id !== user.id) {
      return NextResponse.json(
        { error: 'You do not have permission to perform this action' },
        { status: 403 }
      );
    }

    // Only the actionable types (the registry's set: a fan request, an
    // event invitation, a request to join your event).
    if (!ACTIONABLE_TYPES.has(notification.type)) {
      return NextResponse.json(
        { error: 'This notification does not support actions' },
        { status: 400 }
      );
    }

    // Check if action was already taken
    if (notification.action_status && notification.action_status !== 'pending') {
      return NextResponse.json(
        { error: `Already ${notification.action_status}` },
        { status: 400 }
      );
    }

    // Events program (PR 11): the sport_event_* branches go through the
    // event's own gate and join rules (applyJoin), then stamp the bell.
    if (notification.type === 'sport_event_invite' || notification.type === 'sport_event_request') {
      const meta = (notification.metadata ?? {}) as { sport_event_id?: string; requester_profile_id?: string };
      const eventId = typeof meta.sport_event_id === 'string' ? meta.sport_event_id : null;
      if (!eventId || !isUuid(eventId)) return NextResponse.json({ error: 'This event is no longer available' }, { status: 404 });
      const read = await readSportEventAccess(supabaseAdmin, eventId, user.id, null);
      if (!read) return NextResponse.json({ error: 'This event is no longer available' }, { status: 404 });
      let outcome;
      if (notification.type === 'sport_event_invite') {
        outcome = await applyJoin(supabaseAdmin, { event: read.event, access: read.access, action: action === 'accept' ? 'accept' : 'decline', actorProfileId: user.id });
      } else {
        const requester = typeof meta.requester_profile_id === 'string' ? meta.requester_profile_id : null;
        const { data: row } = requester ? await supabaseAdmin.from('sport_event_participants').select('id').eq('sport_event_id', eventId).eq('profile_id', requester).maybeSingle() : { data: null };
        if (!row) return NextResponse.json({ error: 'That request is no longer open' }, { status: 404 });
        outcome = await applyJoin(supabaseAdmin, { event: read.event, access: read.access, action: action === 'accept' ? 'approve' : 'reject', actorProfileId: user.id, targetParticipantId: row.id as string });
      }
      if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
      const action_status = action === 'accept' ? 'accepted' : 'declined';
      const { error: stampError } = await supabaseAdmin.from('notifications').update({ action_status, is_read: true }).eq('id', id);
      if (stampError) reportRouteError('[NOTIFICATION ACTION] stamp failed:', stampError);
      return NextResponse.json({ success: true, action_status });
    }

    // Get the follow_id
    if (!notification.follow_id) {
      return NextResponse.json(
        { error: 'Follow request not found' },
        { status: 404 }
      );
    }

    // Perform the action based on type
    if (action === 'accept') {
      // Accept the follow request
      const { error: followError } = await supabaseAdmin
        .from('follows')
        .update({ status: 'accepted' })
        .eq('id', notification.follow_id)
        .eq('following_id', user.id) // Ensure user owns this request
        .eq('status', 'pending');

      if (followError) {
        reportRouteError('[NOTIFICATION ACTION] Error accepting follow:', followError);
        return NextResponse.json(
          { error: 'Failed to accept follow request' },
          { status: 500 }
        );
      }

      // Notification status will be updated by trigger
      return NextResponse.json({
        success: true,
        message: 'Follow request accepted',
        action_status: 'accepted'
      });

    } else if (action === 'decline') {
      // Decline (delete) the follow request
      const { error: deleteError } = await supabaseAdmin
        .from('follows')
        .delete()
        .eq('id', notification.follow_id)
        .eq('following_id', user.id) // Ensure user owns this request
        .eq('status', 'pending');

      if (deleteError) {
        reportRouteError('[NOTIFICATION ACTION] Error declining follow:', deleteError);
        return NextResponse.json(
          { error: 'Failed to decline follow request' },
          { status: 500 }
        );
      }

      // Notification status will be updated by trigger
      return NextResponse.json({
        success: true,
        message: 'Follow request declined',
        action_status: 'declined'
      });
    }

    return NextResponse.json(
      { error: 'Invalid action' },
      { status: 400 }
    );

  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[NOTIFICATION ACTION] Error:', error);
    return NextResponse.json(
      { error: 'Failed to process action' },
      { status: 500 }
    );
  }
}
