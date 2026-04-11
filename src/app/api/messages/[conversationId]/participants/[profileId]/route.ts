import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';

// ── DELETE /api/messages/[conversationId]/participants/[profileId] ────────────
// Leave conversation (profileId === self) or remove member (admin only).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string; profileId: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);
    const { conversationId, profileId } = await params;

    const isSelf = profileId === user.id;

    // Verify the requester is an active participant
    const { data: myParticipant } = await supabase
      .from('conversation_participants')
      .select('id, role')
      .eq('conversation_id', conversationId)
      .eq('profile_id', user.id)
      .is('left_at', null)
      .maybeSingle();

    if (!myParticipant) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    if (!isSelf && myParticipant.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can remove participants' }, { status: 403 });
    }

    // Set left_at on the target participant
    const { error } = await supabase
      .from('conversation_participants')
      .update({ left_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('profile_id', profileId)
      .is('left_at', null);

    if (error) {
      console.error('DELETE /api/messages/[id]/participants/[pid] error:', error);
      return NextResponse.json({ error: 'Failed to remove participant' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('DELETE /api/messages/[id]/participants/[pid] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
