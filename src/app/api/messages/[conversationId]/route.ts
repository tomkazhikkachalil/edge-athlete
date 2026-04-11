import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';

// ── GET /api/messages/[conversationId] ───────────────────────────────────────
// Returns conversation details + cursor-paginated messages (50/page, newest first).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);
    const { conversationId } = await params;
    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get('cursor');
    const limit = 50;

    // Guard: verify user is an active participant
    const { data: myParticipant } = await supabase
      .from('conversation_participants')
      .select('id, role, last_read_at, is_muted, joined_at, left_at')
      .eq('conversation_id', conversationId)
      .eq('profile_id', user.id)
      .is('left_at', null)
      .maybeSingle();

    if (!myParticipant) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Fetch conversation details
    const { data: conv, error: convError } = await supabase
      .from('conversations')
      .select('id, type, name, avatar_url, created_by, created_at, updated_at')
      .eq('id', conversationId)
      .single();

    if (convError || !conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Fetch all active participants with profiles
    const { data: participants } = await supabase
      .from('conversation_participants')
      .select(`
        id,
        conversation_id,
        profile_id,
        role,
        last_read_at,
        is_muted,
        joined_at,
        left_at,
        profile:profiles (
          id,
          first_name,
          last_name,
          full_name,
          avatar_url,
          handle
        )
      `)
      .eq('conversation_id', conversationId)
      .is('left_at', null);

    // Fetch messages (cursor-based, newest first)
    let msgQuery = supabase
      .from('messages')
      .select(`
        id,
        conversation_id,
        sender_id,
        type,
        content,
        media_url,
        media_type,
        shared_post_id,
        shared_profile_id,
        deleted_at,
        created_at,
        updated_at,
        sender:profiles!messages_sender_id_fkey (
          id,
          first_name,
          last_name,
          full_name,
          avatar_url,
          handle
        )
      `)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit + 1);

    if (cursor) {
      msgQuery = msgQuery.lt('created_at', cursor);
    }

    const { data: rawMessages, error: msgError } = await msgQuery;

    if (msgError) {
      console.error('GET /api/messages/[id] messages error:', msgError);
      return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
    }

    const hasMore = (rawMessages?.length || 0) > limit;
    const messages = hasMore ? rawMessages!.slice(0, limit) : (rawMessages || []);
    const nextCursor = hasMore && messages.length > 0
      ? messages[messages.length - 1].created_at
      : null;

    // Enrich shared content for non-deleted messages
    const enrichedMessages = await Promise.all(
      messages.map(async (msg) => {
        if (msg.deleted_at) return msg;

        if (msg.type === 'shared_post' && msg.shared_post_id) {
          const { data: post } = await supabase
            .from('posts')
            .select(`
              id, caption, created_at,
              profile:profiles!posts_profile_id_fkey (
                id, first_name, last_name, full_name, avatar_url, handle
              ),
              media:post_media (
                media_url, media_type
              )
            `)
            .eq('id', msg.shared_post_id)
            .maybeSingle();
          return { ...msg, shared_post: post };
        }

        if (msg.type === 'shared_profile' && msg.shared_profile_id) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('id, first_name, last_name, full_name, avatar_url, handle, bio, sport')
            .eq('id', msg.shared_profile_id)
            .maybeSingle();
          return { ...msg, shared_profile: profile };
        }

        return msg;
      })
    );

    // Compute unread count
    let unreadQuery = supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .neq('sender_id', user.id)
      .is('deleted_at', null);

    if (myParticipant.last_read_at) {
      unreadQuery = unreadQuery.gt('created_at', myParticipant.last_read_at);
    }

    const { count: unreadCount } = await unreadQuery;

    const myParticipantFull = {
      ...myParticipant,
      conversation_id: conversationId,
      profile_id: user.id,
      profile: { id: user.id, first_name: null, last_name: null, full_name: null, avatar_url: null, handle: null },
    };

    return NextResponse.json({
      conversation: {
        ...conv,
        participants: participants || [],
        last_message: messages[0] || null,
        unread_count: unreadCount || 0,
        my_participant: myParticipantFull,
      },
      messages: enrichedMessages,
      has_more: hasMore,
      next_cursor: nextCursor,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('GET /api/messages/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── PATCH /api/messages/[conversationId] ─────────────────────────────────────
// Update group settings (name, avatar_url) — admin only.
// Update mute state — any participant.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);
    const { conversationId } = await params;
    const body = await request.json();
    const { name, avatar_url, is_muted } = body;

    // Verify active participant
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

    // Handle mute toggle (any participant)
    if (typeof is_muted === 'boolean') {
      const { error } = await supabase
        .from('conversation_participants')
        .update({ is_muted })
        .eq('id', myParticipant.id);

      if (error) {
        return NextResponse.json({ error: 'Failed to update mute setting' }, { status: 500 });
      }
    }

    // Handle group settings (admin only)
    if (name !== undefined || avatar_url !== undefined) {
      if (myParticipant.role !== 'admin') {
        return NextResponse.json({ error: 'Only admins can update group settings' }, { status: 403 });
      }

      const updates: Record<string, string> = {};
      if (name !== undefined) updates.name = name;
      if (avatar_url !== undefined) updates.avatar_url = avatar_url;

      const { error } = await supabase
        .from('conversations')
        .update(updates)
        .eq('id', conversationId);

      if (error) {
        return NextResponse.json({ error: 'Failed to update group settings' }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('PATCH /api/messages/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
