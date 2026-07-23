import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const user = await requireAuth(request);
    const { id } = await params;
    const body = await request.json();
    const { is_read } = body;

    if (typeof is_read !== 'boolean') {
      return NextResponse.json({ error: 'is_read must be a boolean' }, { status: 400 });
    }

    // Update notification — marking unread also clears read_at
    const updateData: { is_read: boolean; read_at: string | null } = {
      is_read,
      read_at: is_read ? new Date().toISOString() : null,
    };

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
    if (error instanceof Response) return error;
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
    const supabaseAdmin = getSupabaseAdmin();
    const user = await requireAuth(request);
    const { id } = await params;

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
    if (error instanceof Response) return error;
    console.error('[NOTIFICATIONS API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete notification' },
      { status: 500 }
    );
  }
}
