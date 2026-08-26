import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';

// ── POST /api/messages/[conversationId]/participants ──────────────────────────
// Add participants to a group conversation. Admin only.
export async function POST(
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
    const body = await request.json();
    const { profileIds } = body;

    if (!profileIds || !Array.isArray(profileIds) || profileIds.length === 0) {
      return NextResponse.json({ error: 'profileIds array is required' }, { status: 400 });
    }

    // Verify the requester is an admin in this conversation
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
    if (myParticipant.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can add participants' }, { status: 403 });
    }

    // Verify it's a group conversation
    const { data: conv } = await supabase
      .from('conversations')
      .select('type')
      .eq('id', conversationId)
      .single();

    if (conv?.type !== 'group') {
      return NextResponse.json({ error: 'Cannot add participants to a direct message' }, { status: 400 });
    }

    // Skip profiles who are already ACTIVE members — upserting them would
    // demote admins to 'member' and reset their joined_at.
    const candidateIds = profileIds.filter((id: string) => id !== user.id);
    const { data: activeRows } = await supabase
      .from('conversation_participants')
      .select('profile_id')
      .eq('conversation_id', conversationId)
      .in('profile_id', candidateIds)
      .is('left_at', null);
    const alreadyActive = new Set((activeRows || []).map(r => r.profile_id));

    // Upsert participants (re-add if they previously left)
    const newParticipants = candidateIds
      .filter((id: string) => !alreadyActive.has(id))
      .map((id: string) => ({
        conversation_id: conversationId,
        profile_id: id,
        role: 'member',
        left_at: null,
        joined_at: new Date().toISOString(),
      }));

    if (newParticipants.length === 0) {
      return NextResponse.json({ success: true, added: 0 });
    }

    const { error } = await supabase
      .from('conversation_participants')
      .upsert(newParticipants, { onConflict: 'conversation_id,profile_id' });

    if (error) {
      console.error('POST /api/messages/[id]/participants error:', error);
      return NextResponse.json({ error: 'Failed to add participants' }, { status: 500 });
    }

    return NextResponse.json({ success: true, added: newParticipants.length });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('POST /api/messages/[id]/participants error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
