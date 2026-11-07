import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getSupabaseAdmin, requireActiveWriter } from '@/lib/auth-server';
import { extractHandles } from '@/lib/mentions';
import { notifyChatMentions } from '@/lib/mentions/notify';
import { toProxyUrl } from '@/lib/media/proxy-url';
import { reportRouteError } from '@/lib/observability/report';

// ── POST /api/messages/[conversationId]/messages ──────────────────────────────
// Send a message. Media must be pre-uploaded via /api/upload/post-media.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    // 286: the message-send bucket rides on the gate with write-general — one trip.
    const user = await requireActiveWriter(request, { limit: 'message-send' });

    const { conversationId } = await params;
    const body = await request.json();
    const { type, content, media_url, media_type, shared_post_id, shared_profile_id, parent_message_id } = body;

    if (!type) {
      return NextResponse.json({ error: 'Message type is required' }, { status: 400 });
    }

    // ONE pass over the rows every rule below reads (scale round 2 leftovers,
    // Nov 7 2026 — a plain send was 14 trips in 13 stages; now 8 in 7): the
    // sender's profile, and the conversation's ACTIVE rows (left_at null) with
    // each member's profile and the conversation itself embedded. The checks
    // keep their order and their answers; only the reads moved up.
    const GUARDIAN_BLOCK_COPY = "Your guardian's messaging setting doesn't allow this conversation.";
    type MemberProfile = { id: string; handle: string | null; supervision_state: string | null; messaging_permission: string | null };
    type Conversation = { type: string; name: string | null; frozen_at: string | null };
    type MemberRow = { profile_id: string; is_muted: boolean | null; held_at: string | null; conversation: Conversation | Conversation[] | null; profile: MemberProfile | MemberProfile[] | null };
    const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
    const [{ data: senderProfile }, { data: memberRows }] = await Promise.all([
      supabase
        .from('profiles')
        .select('supervision_state, messaging_permission, first_name, last_name, full_name')
        .eq('id', user.id)
        .maybeSingle(),
      supabase
        .from('conversation_participants')
        .select('profile_id, is_muted, held_at, conversation:conversations!inner (type, name, frozen_at), profile:profiles (id, handle, supervision_state, messaging_permission)')
        .eq('conversation_id', conversationId)
        .is('left_at', null),
    ]);
    const members = (memberRows ?? []) as MemberRow[];

    // Supervised sender kill-switch: 'nobody' bites immediately, even on
    // existing conversations — it's the emergency lever a guardian pulls.
    const senderSupervised = senderProfile?.supervision_state === 'supervised';
    if (senderSupervised && senderProfile?.messaging_permission === 'nobody') {
      return NextResponse.json({ error: GUARDIAN_BLOCK_COPY }, { status: 403 });
    }

    // Guard: verify user is an active, unheld participant (a held child
    // can't see the conversation, so they can't send into it either).
    const me = members.find(m => m.profile_id === user.id && !m.held_at) ?? null;
    if (!me) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    const conversation = one(me.conversation);

    // Spec 2 (mig 223): a thread frozen by a Critical report takes no new
    // messages from either side until the review; reading stays open (the
    // moderation module's rule — `frozen_at` set — read off the embed).
    if (conversation?.frozen_at) {
      return NextResponse.json({ error: 'This conversation is paused while a report is reviewed.', code: 'conversation_frozen' }, { status: 403 });
    }

    // Round I + Wave 3: EVERY direct send touching a supervised profile is
    // re-checked — a guardian tightening the dial mid-conversation takes
    // effect on the next message. Wave 3 closed the audit hole where this
    // block keyed only on the SENDER being supervised: an adult sending into
    // an existing DM with a child now re-passes blocks, the child's inbound
    // tier, and the first-contact gate. Groups stay create-side-gated
    // (their membership is fixed by people who passed the gate).
    const conversationType = conversation?.type;
    const others = members.filter(m => m.profile_id !== user.id);
    if (conversationType === 'direct') {
      const other = others[0] ?? null;
      const otherId = other?.profile_id;
      if (otherId) {
        const otherProfile = one(other.profile);
        const otherSupervised = otherProfile?.supervision_state === 'supervised';

        if (senderSupervised || otherSupervised) {
          // The two follow directions in one read, the block pair in another.
          const [{ data: followRows }, { data: blockRow }] = await Promise.all([
            supabase.from('follows').select('follower_id, following_id').eq('status', 'accepted')
              .or(`and(follower_id.eq.${user.id},following_id.eq.${otherId}),and(follower_id.eq.${otherId},following_id.eq.${user.id})`),  // hardening-ok: session UUID + DB-sourced UUID
            supabase.from('user_blocks').select('id')
              .or(`and(blocker_id.eq.${user.id},blocked_id.eq.${otherId}),and(blocker_id.eq.${otherId},blocked_id.eq.${user.id})`)  // hardening-ok: session UUID + DB-sourced UUID
              .maybeSingle(),
          ]);
          const follows = (followRows ?? []) as Array<{ follower_id: string; following_id: string }>;
          const iFollow = follows.some(f => f.follower_id === user.id && f.following_id === otherId);
          const followsMe = follows.some(f => f.follower_id === otherId && f.following_id === user.id);
          if (blockRow) {
            return NextResponse.json({ error: 'Cannot message this user' }, { status: 403 });
          }
          if (senderSupervised) {
            const permission = (senderProfile?.messaging_permission || 'everyone') as
              import('@/lib/supervised-gates').MessagingPermission;
            const { outboundAllowed } = await import('@/lib/supervised-gates');
            if (!outboundAllowed(permission, iFollow, followsMe)) {
              return NextResponse.json({ error: GUARDIAN_BLOCK_COPY }, { status: 403 });
            }
          }
          if (otherSupervised) {
            // The child's inbound tier, re-applied per send (create-POST rules).
            const perm = otherProfile?.messaging_permission || 'everyone';
            if (perm === 'nobody') {
              return NextResponse.json({ error: 'This user is not accepting messages' }, { status: 403 });
            }
            if (perm === 'fans_only' && !iFollow) {
              return NextResponse.json({ error: 'This user only accepts messages from their fans' }, { status: 403 });
            }
            if (perm === 'mutual_fans' && !(iFollow && followsMe)) {
              return NextResponse.json({ error: 'This user only accepts messages from mutual fans' }, { status: 403 });
            }
            // First-contact hold (mig 131): an unknown sender's message still
            // inserts — it DELIVERS on approval — but the child's row is held
            // and the guardians belled (once, on the transition).
            const { applyFirstContactGate, holdChildRow } = await import('@/lib/first-contact');
            const gate = await applyFirstContactGate(supabase, user.id, otherId);
            if (gate.hold && gate.childId) {
              await holdChildRow(supabase, conversationId, gate.childId, user.id);
            }
          }
        }
      }
    }

    // Validate type against the known enum (unknown types used to hit the DB
    // CHECK constraint → 500 instead of 400) and UUID-shaped reference ids.
    const VALID_MESSAGE_TYPES = ['text', 'image', 'video', 'gif_reaction', 'shared_post', 'shared_profile'];
    if (!VALID_MESSAGE_TYPES.includes(type)) {
      return NextResponse.json({ error: 'Invalid message type' }, { status: 400 });
    }
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
      reportRouteError('POST /api/messages/[id]/messages insert error:', msgError);
      return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
    }

    // Fan out notifications to non-muted, non-sender active participants —
    // the rows from the one pass above. Held children (131) are excluded —
    // their bell rings on approval, via the conversation simply appearing
    // with its unread count.
    const recipients = others.filter(m => m.is_muted === false && !m.held_at);

    if (recipients.length > 0) {
      const senderName = senderProfile?.full_name ||
        [senderProfile?.first_name, senderProfile?.last_name].filter(Boolean).join(' ') ||
        'Someone';

      const notifTitle = conversation?.type === 'group' && conversation?.name
        ? `New message in ${conversation.name}`
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
        .or(`and(blocked_id.eq.${user.id},blocker_id.in.(${recipientIds.join(',')})),and(blocker_id.eq.${user.id},blocked_id.in.(${recipientIds.join(',')}))`);  // hardening-ok: session UUID + DB-sourced UUID list
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
    // by construction. Best-effort; never fails the send. The handles come
    // from the one pass above (an unheld member's profile embed).
    if (type === 'text' && content) {
      const handles = extractHandles(content);
      if (handles.length > 0) {
        const handleSet = new Set(handles);
        const mentionedIds = others
          .filter(m => {
            if (m.held_at) return false;
            const handle = one(m.profile)?.handle;
            return !!handle && handleSet.has(handle.toLowerCase());
          })
          .map(m => m.profile_id);
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

    // Proxy the media so the sender's optimistic render uses the authorized
    // path, not a raw public URL (matches what the list GET returns).
    const responseMessage = {
      ...message,
      media_url: toProxyUrl(message.media_url, { type: 'message', id: message.id }, { visibility: 'private' }),
    };
    return NextResponse.json({ message: responseMessage }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('POST /api/messages/[id]/messages error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
