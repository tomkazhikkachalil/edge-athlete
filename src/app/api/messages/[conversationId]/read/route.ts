import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { reportRouteError } from '@/lib/observability/report';

// ── PATCH /api/messages/[conversationId]/read ─────────────────────────────────
// Mark conversation as read by updating last_read_at on the participant row.
// Oct 4 2026: the conversation's `new_message` bells are read with it — the
// one place those rows were ever marked read was a tap on the row itself, so
// the bell's dot and the app icon's number stayed up after the chat was read.
// The response carries how many were cleared (the client lowers its count).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);
    const { conversationId } = await params;
    if (!isUuid(conversationId)) {
      return NextResponse.json({ error: 'Invalid conversation ID' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const { error } = await supabase
      .from('conversation_participants')
      .update({ last_read_at: now })
      .eq('conversation_id', conversationId)
      .eq('profile_id', user.id)
      .is('left_at', null)
      .is('held_at', null);

    if (error) {
      reportRouteError('PATCH /api/messages/[id]/read error:', error);
      return NextResponse.json({ error: 'Failed to mark as read' }, { status: 500 });
    }

    // The bells for this conversation (metadata.conversation_id is what the
    // messages route writes; the push tag `message:<id>` is built from it).
    const { count, error: bellError } = await supabase
      .from('notifications')
      .update({ is_read: true, read_at: now }, { count: 'exact' })
      .eq('user_id', user.id)
      .eq('type', 'new_message')
      .eq('is_read', false)
      .eq('metadata->>conversation_id', conversationId);
    if (bellError) {
      // The conversation IS read; the bells catch up on the next list read.
      reportRouteError('PATCH /api/messages/[id]/read — bells:', bellError);
    }

    return NextResponse.json({ success: true, notifications_read: count ?? 0 });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('PATCH /api/messages/[id]/read error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
