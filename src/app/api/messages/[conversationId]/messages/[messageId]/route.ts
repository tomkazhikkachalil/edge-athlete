import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';

// ── DELETE /api/messages/[conversationId]/messages/[messageId] ───────────────
// Soft-delete own message (sets deleted_at; record is preserved in DB).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string; messageId: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);
    const { messageId } = await params;

    // Only the sender can delete their own messages
    const { data: message } = await supabase
      .from('messages')
      .select('id, sender_id')
      .eq('id', messageId)
      .is('deleted_at', null)
      .maybeSingle();

    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    if (message.sender_id !== user.id) {
      return NextResponse.json({ error: 'Cannot delete another user\'s message' }, { status: 403 });
    }

    const { error } = await supabase
      .from('messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', messageId);

    if (error) {
      console.error('DELETE /api/messages/[conversationId]/messages/[messageId] error:', error);
      return NextResponse.json({ error: 'Failed to delete message' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('DELETE /api/messages/[conversationId]/messages/[messageId] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
