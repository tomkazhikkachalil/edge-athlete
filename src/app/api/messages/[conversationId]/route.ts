import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { toProxyUrl } from '@/lib/media/proxy-url';

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
    if (!isUuid(conversationId)) {
      return NextResponse.json({ error: 'Invalid conversation ID' }, { status: 400 });
    }
    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get('cursor');
    // Honor ?limit= (clamped 1–50; default 50). ChatWindow's realtime handler
    // passes limit=1 to fetch just the newest message.
    const rawLimit = parseInt(searchParams.get('limit') || '50', 10);
    const limit = Number.isNaN(rawLimit) ? 50 : Math.min(Math.max(rawLimit, 1), 50);

    // Guard: verify user is an active participant
    const { data: myParticipant } = await supabase
      .from('conversation_participants')
      .select('id, role, last_read_at, is_muted, joined_at, left_at')
      .eq('conversation_id', conversationId)
      .eq('profile_id', user.id)
      .is('left_at', null)
      .is('held_at', null)
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
        held_at,
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
    // Exclude gif_reactions from top-level list — they'll be nested under parent.
    // Replies (non-gif_reaction with parent_message_id) stay in the main list.
    // NOTE: `edited_at` comes from migration 019 (applied). It is included in
    // the SELECT so the "edited" indicator survives page reloads, not just
    // realtime payloads.
    //
    // GIF reactions (type='gif_reaction') are NOT filtered out — they flow
    // through the regular reply pipeline and render as standalone messages
    // aligned to their sender, with a QuotedReply preview of the parent.
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
        parent_message_id,
        deleted_at,
        created_at,
        updated_at,
        edited_at,
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

    // Privacy filter for shared posts: this route runs on the admin client
    // (bypasses posts RLS), so post visibility must be enforced here. A shared
    // post is viewable when the owner's profile is visible to the viewer AND
    // (the post is public OR the viewer follows the owner). Per-owner access
    // is cached for the duration of the request.
    const ownerAccessCache = new Map<string, { profilePublic: boolean; isFollower: boolean }>();
    const filterViewableSharedPost = async <T extends { visibility?: string | null; profile: unknown } | null>(post: T): Promise<T | null> => {
      if (!post) return null;
      const owner = (Array.isArray(post.profile) ? post.profile[0] : post.profile) as { id?: string } | null;
      const ownerId = owner?.id;
      if (!ownerId) return null;
      if (ownerId === user.id) return post;
      let access = ownerAccessCache.get(ownerId);
      if (!access) {
        const [{ data: ownerProfile }, { data: follow }] = await Promise.all([
          supabase.from('profiles').select('visibility').eq('id', ownerId).maybeSingle(),
          supabase.from('follows').select('id').eq('follower_id', user.id).eq('following_id', ownerId).eq('status', 'accepted').maybeSingle(),
        ]);
        access = { profilePublic: ownerProfile?.visibility !== 'private', isFollower: !!follow };
        ownerAccessCache.set(ownerId, access);
      }
      const profileOk = access.profilePublic || access.isFollower;
      const postOk = post.visibility !== 'private' || access.isFollower;
      return profileOk && postOk ? post : null;
    };

    // Enrich shared content for non-deleted messages
    const enrichedMessages = await Promise.all(
      messages.map(async (msg) => {
        if (msg.deleted_at) {
          // Soft-deleted: the UI shows "Message deleted" — never ship the
          // original content/media back to clients.
          return { ...msg, content: null, media_url: null, media_type: null, shared_post_id: null, shared_profile_id: null };
        }

        // The message's own media (image/video) is proxied and re-authorized
        // per participant. A gif_reaction is an external Giphy URL, which
        // toProxyUrl leaves untouched (not a protected bucket).
        const mediaUrl = toProxyUrl(msg.media_url, { type: 'message', id: msg.id });

        if (msg.type === 'shared_post' && msg.shared_post_id) {
          const { data: post } = await supabase
            .from('posts')
            .select(`
              id, caption, visibility, created_at,
              profile:profiles!posts_profile_id_fkey (
                id, first_name, last_name, full_name, avatar_url, handle
              ),
              media:post_media (
                media_url, media_type
              )
            `)
            .eq('id', msg.shared_post_id)
            .maybeSingle();
          const viewable = await filterViewableSharedPost(post);
          // The shared original's media is post media — proxied under the
          // original post's id (its own visibility governs it).
          const shared_post = viewable
            ? {
                ...viewable,
                media: (viewable.media || []).map((m: { media_url: string; media_type: string }) => ({
                  ...m,
                  media_url: toProxyUrl(m.media_url, { type: 'post', id: viewable.id }),
                })),
              }
            : null;
          return { ...msg, media_url: mediaUrl, shared_post };
        }

        if (msg.type === 'shared_profile' && msg.shared_profile_id) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('id, first_name, last_name, full_name, avatar_url, handle, bio, sport')
            .eq('id', msg.shared_profile_id)
            .maybeSingle();
          return { ...msg, media_url: mediaUrl, shared_profile: profile };
        }

        return { ...msg, media_url: mediaUrl };
      })
    );

    // Enrich with emoji reactions (the chip-style reactions on each message).
    // GIF reactions are now part of `enrichedMessages` itself — they are
    // ordinary messages with parent_message_id, surfaced through the same
    // reply_to pipeline as text replies. The separate gif_reactions array is
    // no longer needed.
    const messageIds = enrichedMessages
      .filter(m => !m.deleted_at)
      .map(m => m.id);

    // Reactor profiles are fetched separately below to avoid coupling this
    // query to a specific FK constraint name in the schema cache.
    const emojiReactionsResult = messageIds.length > 0
      ? await supabase
          .from('message_reactions')
          .select('message_id, emoji, profile_id')
          .in('message_id', messageIds)
      : { data: [] };

    // Aggregate emoji reactions per message, tracking reactor profiles per emoji.
    type ReactorProfile = {
      id: string;
      first_name: string | null;
      last_name: string | null;
      full_name: string | null;
      avatar_url: string | null;
      handle: string | null;
    };
    type ReactionEntry = { count: number; reacted: boolean; reactors: ReactorProfile[] };
    const reactionsByMessage = new Map<string, Map<string, ReactionEntry>>();
    const reactionOrder = new Map<string, string[]>();

    // Resolve reactor profiles via a separate fetch keyed by profile id so
    // we don't depend on a specific FK constraint name in PostgREST's schema
    // cache. Profile data is then merged into the aggregation below. Best
    // effort — if this fetch fails the reactions still render, just without
    // names/avatars in the "who reacted" popover.
    const reactorProfilesById = new Map<string, ReactorProfile>();
    const reactorIds = Array.from(new Set(
      (emojiReactionsResult.data || []).map(r => r.profile_id).filter(Boolean)
    ));
    if (reactorIds.length > 0) {
      const { data: reactorProfiles } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, full_name, avatar_url, handle')
        .in('id', reactorIds);
      for (const p of reactorProfiles || []) {
        reactorProfilesById.set(p.id, p as ReactorProfile);
      }
    }

    for (const r of emojiReactionsResult.data || []) {
      if (!reactionsByMessage.has(r.message_id)) {
        reactionsByMessage.set(r.message_id, new Map());
        reactionOrder.set(r.message_id, []);
      }
      const msgReactions = reactionsByMessage.get(r.message_id)!;
      if (!msgReactions.has(r.emoji)) {
        msgReactions.set(r.emoji, { count: 0, reacted: false, reactors: [] });
        reactionOrder.get(r.message_id)!.push(r.emoji);
      }
      const entry = msgReactions.get(r.emoji)!;
      entry.count++;
      if (r.profile_id === user.id) entry.reacted = true;

      const reactor = reactorProfilesById.get(r.profile_id);
      if (reactor) {
        entry.reactors.push(reactor);
      }
    }

    // Fetch parent messages for replies. Now that GIF reactions are part of
    // enrichedMessages they are included here automatically — both text
    // replies and GIF reactions get their reply_to populated below.
    const replyParentIds = enrichedMessages
      .filter(m => m.parent_message_id && !m.deleted_at)
      .map(m => m.parent_message_id as string);

    const uniqueParentIds = [...new Set(replyParentIds)];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parentMessagesMap = new Map<string, { id: string; sender_id: string; type: string; content: string | null; media_url: string | null; deleted_at: string | null; sender_name: string; shared_post?: any; shared_profile?: any }>();

    if (uniqueParentIds.length > 0) {
      const { data: parentMsgs } = await supabase
        .from('messages')
        .select(`
          id, sender_id, type, content, media_url, deleted_at,
          shared_post_id, shared_profile_id,
          sender:profiles!messages_sender_id_fkey (
            first_name, last_name, full_name
          )
        `)
        .in('id', uniqueParentIds);

      for (const pm of parentMsgs || []) {
        const rawSender = pm.sender as unknown;
        const s = (Array.isArray(rawSender) ? rawSender[0] : rawSender) as { first_name: string | null; last_name: string | null; full_name: string | null } | null;
        const senderName = s?.full_name
          || [s?.first_name, s?.last_name].filter(Boolean).join(' ')
          || 'Unknown';
        parentMessagesMap.set(pm.id, {
          id: pm.id,
          sender_id: pm.sender_id,
          type: pm.type,
          // Soft-deleted parents render as "Message deleted" — never ship
          // the original content/media in the reply preview.
          content: pm.deleted_at ? null : pm.content,
          media_url: pm.deleted_at ? null : pm.media_url,
          deleted_at: pm.deleted_at,
          sender_name: senderName,
        });
      }

      // Enrich immediate parent messages that are shared_post or shared_profile types
      const postParents = (parentMsgs || []).filter(pm => pm.type === 'shared_post' && pm.shared_post_id && !pm.deleted_at);
      const profileParents = (parentMsgs || []).filter(pm => pm.type === 'shared_profile' && pm.shared_profile_id && !pm.deleted_at);

      const [parentPostsResult, parentProfilesResult] = await Promise.all([
        postParents.length > 0
          ? supabase
              .from('posts')
              .select(`
                id, caption, visibility, created_at,
                profile:profiles!posts_profile_id_fkey (
                  id, first_name, last_name, full_name, avatar_url, handle
                ),
                media:post_media (
                  media_url, media_type
                )
              `)
              .in('id', postParents.map(pm => pm.shared_post_id))
          : Promise.resolve({ data: [] }),
        profileParents.length > 0
          ? supabase
              .from('profiles')
              .select('id, first_name, last_name, full_name, avatar_url, handle, bio, sport')
              .in('id', profileParents.map(pm => pm.shared_profile_id))
          : Promise.resolve({ data: [] }),
      ]);

      // Build lookup maps
      const parentPostsById = new Map((parentPostsResult.data || []).map(p => [p.id, p]));
      const parentProfilesById = new Map((parentProfilesResult.data || []).map(p => [p.id, p]));

      // Attach to parentMessagesMap entries (privacy-filtered, same as
      // top-level shared posts)
      for (const pm of postParents) {
        const entry = parentMessagesMap.get(pm.id);
        if (entry) entry.shared_post = await filterViewableSharedPost(parentPostsById.get(pm.shared_post_id) ?? null);
      }
      for (const pm of profileParents) {
        const entry = parentMessagesMap.get(pm.id);
        if (entry) entry.shared_profile = parentProfilesById.get(pm.shared_profile_id) ?? null;
      }
    }

    // Helper: strip internal parent_message_id from map entries for client output
    const toReplyPreview = (entry: typeof parentMessagesMap extends Map<string, infer V> ? V : never) => ({
      id: entry.id,
      sender_id: entry.sender_id,
      sender_name: entry.sender_name,
      type: entry.type,
      content: entry.content,
      media_url: entry.media_url,
      deleted_at: entry.deleted_at,
      ...(entry.shared_post ? { shared_post: entry.shared_post } : {}),
      ...(entry.shared_profile ? { shared_profile: entry.shared_profile } : {}),
    });

    // Attach reactions and reply_to to each message. GIF reactions are now
    // standalone messages in this list, so the legacy `gif_reactions` array
    // is intentionally omitted from the response payload.
    const messagesWithReactions = enrichedMessages.map(msg => {
      const msgReactions = reactionsByMessage.get(msg.id);
      const order = reactionOrder.get(msg.id);
      const reactions = msgReactions && order
        ? order.map(emoji => ({ emoji, ...msgReactions.get(emoji)! }))
        : [];

      const parentEntry = msg.parent_message_id
        ? parentMessagesMap.get(msg.parent_message_id) ?? null
        : null;
      const reply_to = parentEntry ? toReplyPreview(parentEntry) : null;

      return {
        ...msg,
        reactions,
        reply_to,
      };
    });

    // Compute unread count. GIF reactions count as replies (same treatment
    // as text replies) — they're real messages in the chat stream.
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
      messages: messagesWithReactions,
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
    if (!isUuid(conversationId)) {
      return NextResponse.json({ error: 'Invalid conversation ID' }, { status: 400 });
    }
    const body = await request.json();
    const { name, avatar_url, is_muted } = body;

    // Verify active participant
    const { data: myParticipant } = await supabase
      .from('conversation_participants')
      .select('id, role')
      .eq('conversation_id', conversationId)
      .eq('profile_id', user.id)
      .is('left_at', null)
      .is('held_at', null)
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
