import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { extractHandles } from '@/lib/mentions';
import { notifyChatMentions } from '@/lib/mentions/notify';

// ── POST /api/messages/[conversationId]/messages ──────────────────────────────
// Send a message. Media must be pre-uploaded via /api/upload/post-media.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);
    const { conversationId } = await params;
    const body = await request.json();
    const { type, content, media_url, media_type, shared_post_id, shared_profile_id, parent_message_id } = body;

    if (!type) {
      return NextResponse.json({ error: 'Message type is required' }, { status: 400 });
    }

    // Guard: verify user is an active participant
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

    // Validate type against the known enum (unknown types used to hit the DB
    // CHECK constraint → 500 instead of 400) and UUID-shaped reference ids.
    const VALID_MESSAGE_TYPES = ['text', 'image', 'video', 'gif_reaction', 'shared_post', 'shared_profile'];
    if (!VALID_MESSAGE_TYPES.includes(type)) {
      return NextResponse.json({ error: 'Invalid message type' }, { status: 400 });
    }
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const [field, value] of [['shared_post_id', shared_post_id], ['shared_profile_id', shared_profile_id], ['parent_message_id', parent_message_id]] as const) {
      if (value && (typeof value !== 'string' || !UUID_RE.test(value))) {
        return NextResponse.json({ error: `Invalid ${field}` }, { status: 400 });
      }
    }

    // Validate content by type
    if (type === 'text' && !content?.trim()) {
      return NextResponse.json({ error: 'Text content is required' }, { status: 400 });
    }
    if ((type === 'image' || type === 'video') && !media_url) {
      return NextResponse.json({ error: 'media_url is required for media messages' }, { status: 400 });
    }
    if (type === 'shared_post' && !shared_post_id) {
      return NextResponse.json({ error: 'shared_post_id is required' }, { status: 400 });
    }
    if (type === 'shared_profile' && !shared_profile_id) {
      return NextResponse.json({ error: 'shared_profile_id is required' }, { status: 400 });
    }
    if (type === 'gif_reaction') {
      if (!media_url) {
        return NextResponse.json({ error: 'media_url is required for gif_reaction' }, { status: 400 });
      }
      if (!parent_message_id) {
        return NextResponse.json({ error: 'parent_message_id is required for gif_reaction' }, { status: 400 });
      }
    }

    // Validate parent_message_id if provided (replies + gif_reactions)
    if (parent_message_id) {
      const { data: parentMsg } = await supabase
        .from('messages')
        .select('id')
        .eq('id', parent_message_id)
        .eq('conversation_id', conversationId)
        .is('deleted_at', null)
        .maybeSingle();
      if (!parentMsg) {
        return NextResponse.json({ error: 'Parent message not found' }, { status: 404 });
      }
    }

    // Insert message
    const { data: message, error: msgError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: user.id,
        type,
        content: content?.trim() || null,
        media_url: media_url || null,
        media_type: media_type || null,
        shared_post_id: shared_post_id || null,
        shared_profile_id: shared_profile_id || null,
        parent_message_id: parent_message_id || null,
      })
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
        parent_message_id,
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
      .single();

    if (msgError || !message) {
      console.error('POST /api/messages/[id]/messages insert error:', msgError);
      return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
    }

    // Fan out notifications to non-muted, non-sender active participants
    const { data: recipients } = await supabase
      .from('conversation_participants')
      .select('profile_id')
      .eq('conversation_id', conversationId)
      .neq('profile_id', user.id)
      .eq('is_muted', false)
      .is('left_at', null);

    if (recipients && recipients.length > 0) {
      // Get conversation name for notification context
      const { data: conv } = await supabase
        .from('conversations')
        .select('type, name')
        .eq('id', conversationId)
        .single();

      const { data: senderProfile } = await supabase
        .from('profiles')
        .select('first_name, last_name, full_name')
        .eq('id', user.id)
        .single();

      const senderName = senderProfile?.full_name ||
        [senderProfile?.first_name, senderProfile?.last_name].filter(Boolean).join(' ') ||
        'Someone';

      const notifTitle = conv?.type === 'group' && conv?.name
        ? `New message in ${conv.name}`
        : `${senderName} sent you a message`;

      const notifMessage = type === 'text'
        ? (content?.slice(0, 80) || '')
        : type === 'image' ? 'Sent a photo'
        : type === 'video' ? 'Sent a video'
        : type === 'shared_post' ? 'Shared a post'
        : type === 'gif_reaction' ? 'Reacted with a GIF'
        : 'Shared a profile';

      // Don't notify across a block in either direction (blocks prevent DM
      // creation, but blocked pairs can still share a pre-existing group).
      const recipientIds = recipients.map(r => r.profile_id);
      const { data: blockRows } = await supabase
        .from('user_blocks')
        .select('blocker_id, blocked_id')
        .or(`and(blocked_id.eq.${user.id},blocker_id.in.(${recipientIds.join(',')})),and(blocker_id.eq.${user.id},blocked_id.in.(${recipientIds.join(',')}))`);
      const blockedSet = new Set(
        (blockRows || []).flatMap(b => [b.blocker_id, b.blocked_id]).filter(id => id !== user.id)
      );
      const notifRecipients = recipients.filter(r => !blockedSet.has(r.profile_id));

      const notifications = notifRecipients.map(r => ({
        user_id: r.profile_id,
        type: 'new_message',
        actor_id: user.id,
        title: notifTitle,
        message: notifMessage,
        action_url: `/messages?c=${conversationId}`,
        is_read: false,
        metadata: { conversation_id: conversationId, message_id: message.id },
      }));

      if (notifications.length > 0) {
        await supabase.from('notifications').insert(notifications);
      }
    }

    // @mention notifications: tokens matching an ACTIVE member's handle get
    // a distinct 'mention' row on top of new_message. Deliberately NOT
    // filtered by is_muted — mute silences the room, a direct mention is
    // personal (Slack/Discord semantics). Non-member @names notify no one
    // by construction. Best-effort; never fails the send.
    if (type === 'text' && content) {
      const handles = extractHandles(content);
      if (handles.length > 0) {
        const { data: mentionables } = await supabase
          .from('conversation_participants')
          .select('profile_id, profile:profiles(id, handle)')
          .eq('conversation_id', conversationId)
          .neq('profile_id', user.id)
          .is('left_at', null);
        const handleSet = new Set(handles);
        const mentionedIds = (mentionables ?? [])
          .filter(r => {
            const prof = r.profile as unknown as { handle: string | null } | null;
            return prof?.handle && handleSet.has(prof.handle.toLowerCase());
          })
          .map(r => r.profile_id);
        if (mentionedIds.length > 0) {
          await notifyChatMentions(supabase, {
            conversationId,
            messageId: message.id,
            senderId: user.id,
            mentionedIds,
          });
        }
      }
    }

    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('POST /api/messages/[id]/messages error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
