import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth-server';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    const body = await request.json();
    const { is_read } = body;

    console.log('[NOTIFICATIONS API] PATCH request:', {
      userId: user.id,
      notificationId: id,
      is_read
    });

    // Update notification
    const updateData: { is_read: boolean; read_at?: string } = { is_read };

    if (is_read) {
      updateData.read_at = new Date().toISOString();
    }

    const { error } = await supabaseAdmin
      .from('notifications')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', user.id); // Ensure user owns this notification

    if (error) {
      console.error('[NOTIFICATIONS API] Error updating notification:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('[NOTIFICATIONS API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update notification' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;

    console.log('[NOTIFICATIONS API] DELETE request:', {
      userId: user.id,
      notificationId: id
    });

    const { error } = await supabaseAdmin
      .from('notifications')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id); // Ensure user owns this notification

    if (error) {
      console.error('[NOTIFICATIONS API] Error deleting notification:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('[NOTIFICATIONS API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete notification' },
      { status: 500 }
    );
  }
}
