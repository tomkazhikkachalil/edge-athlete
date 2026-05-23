import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';

const EDIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// ── PATCH /api/messages/[conversationId]/messages/[messageId] ────────────────
// Edit own text message. Sender-only, ≤15 min since created_at, not deleted,
// type must be 'text'. Sets `edited_at = now()`. Returns the updated row.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string; messageId: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);
    const { conversationId, messageId } = await params;
    const body = await request.json();
    const { content } = body;

    if (typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }

    const trimmed = content.trim();

    // Confirm caller is an active participant of the conversation. Mirrors
    // the guard used everywhere else in this route tree.
    const { data: myParticipant } = await supabase
      .from('conversation_participants')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('profile_id', user.id)
      .is('left_at', null)
      .maybeSingle();

    if (!myParticipant) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Fetch the target message to enforce edit eligibility.
    const { data: message } = await supabase
      .from('messages')
      .select('id, sender_id, conversation_id, type, deleted_at, created_at')
      .eq('id', messageId)
      .eq('conversation_id', conversationId)
      .maybeSingle();

    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    if (message.sender_id !== user.id) {
      return NextResponse.json({ error: 'Cannot edit another user\'s message' }, { status: 403 });
    }

    if (message.deleted_at) {
      return NextResponse.json({ error: 'Cannot edit a deleted message' }, { status: 403 });
    }

    if (message.type !== 'text') {
      return NextResponse.json({ error: 'Only text messages can be edited' }, { status: 403 });
    }

    const ageMs = Date.now() - new Date(message.created_at).getTime();
    if (ageMs > EDIT_WINDOW_MS) {
      return NextResponse.json({ error: 'Edit window has expired' }, { status: 403 });
    }

    const editedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from('messages')
      .update({ content: trimmed, edited_at: editedAt })
      .eq('id', messageId)
      .select('id, content, edited_at, updated_at')
      .single();

    if (updateError || !updated) {
      console.error('PATCH /api/messages/[conversationId]/messages/[messageId] error:', updateError);
      return NextResponse.json({ error: 'Failed to edit message' }, { status: 500 });
    }

    return NextResponse.json({ message: updated });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('PATCH /api/messages/[conversationId]/messages/[messageId] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

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
