import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth-server';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
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
      .select('id, user_id, type, follow_id, action_status')
      .eq('id', id)
      .single();

    if (notifError || !notification) {
      console.error('[NOTIFICATION ACTION] Error fetching notification:', notifError);
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

    // Only allow actions on follow_request notifications
    if (notification.type !== 'follow_request') {
      return NextResponse.json(
        { error: 'This notification does not support actions' },
        { status: 400 }
      );
    }

    // Check if action was already taken
    if (notification.action_status && notification.action_status !== 'pending') {
      return NextResponse.json(
        { error: `Follow request already ${notification.action_status}` },
        { status: 400 }
      );
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
        console.error('[NOTIFICATION ACTION] Error accepting follow:', followError);
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
        console.error('[NOTIFICATION ACTION] Error declining follow:', deleteError);
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
    console.error('[NOTIFICATION ACTION] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process action' },
      { status: 500 }
    );
  }
}
