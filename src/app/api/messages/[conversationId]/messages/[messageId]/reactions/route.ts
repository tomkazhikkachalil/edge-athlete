import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';

// ── POST /api/messages/[conversationId]/messages/[messageId]/reactions ────────
// Toggle an emoji reaction on a message.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string; messageId: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);
    const { conversationId, messageId } = await params;
    const body = await request.json();
    const { emoji } = body;

    if (!emoji || typeof emoji !== 'string') {
      return NextResponse.json({ error: 'emoji is required' }, { status: 400 });
    }

    // Verify user is an active participant in this conversation
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

    // Verify message exists in this conversation
    const { data: message } = await supabase
      .from('messages')
      .select('id')
      .eq('id', messageId)
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
      .maybeSingle();

    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    // Check if user already reacted with this emoji
    const { data: existing } = await supabase
      .from('message_reactions')
      .select('id')
      .eq('message_id', messageId)
      .eq('profile_id', user.id)
      .eq('emoji', emoji)
      .maybeSingle();

    if (existing) {
      // Remove the reaction
      await supabase
        .from('message_reactions')
        .delete()
        .eq('id', existing.id);
    } else {
      // Add the reaction
      const { error: insertError } = await supabase
        .from('message_reactions')
        .insert({
          message_id: messageId,
          profile_id: user.id,
          emoji,
        });

      if (insertError) {
        // Handle duplicate race condition
        if (insertError.code === '23505') {
          // Already exists — treat as no-op, will return fresh aggregation below
        } else {
          console.error('Error inserting reaction:', insertError);
          return NextResponse.json({ error: 'Failed to add reaction' }, { status: 500 });
        }
      }
    }

    // Return fresh aggregated reactions for this message
    const { data: rawReactions } = await supabase
      .from('message_reactions')
      .select('emoji, profile_id')
      .eq('message_id', messageId);

    // Aggregate by emoji
    const emojiMap = new Map<string, { count: number; reacted: boolean }>();
    const insertionOrder: string[] = [];

    for (const r of rawReactions || []) {
      if (!emojiMap.has(r.emoji)) {
        emojiMap.set(r.emoji, { count: 0, reacted: false });
        insertionOrder.push(r.emoji);
      }
      const entry = emojiMap.get(r.emoji)!;
      entry.count++;
      if (r.profile_id === user.id) entry.reacted = true;
    }

    const reactions = insertionOrder.map(emoji => ({
      emoji,
      ...emojiMap.get(emoji)!,
    }));

    return NextResponse.json({ reactions });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('POST /api/messages/.../reactions error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
