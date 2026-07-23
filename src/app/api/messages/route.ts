import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import type { Conversation, ConversationParticipant, Message } from '@/types/messages';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── GET /api/messages ─────────────────────────────────────────────────────────
// List all active conversations for the current user, ordered by updated_at DESC.
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);

    // 1. Get all conversations the user is an active participant in
    const { data: participantRows, error: pError } = await supabase
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
        conversation:conversations (
          id,
          type,
          name,
          avatar_url,
          created_by,
          created_at,
          updated_at
        )
      `)
      .eq('profile_id', user.id)
      .is('left_at', null)
      .order('joined_at', { ascending: false });

    if (pError) {
      console.error('GET /api/messages participants error:', pError);
      return NextResponse.json({ error: 'Failed to load conversations' }, { status: 500 });
    }

    if (!participantRows || participantRows.length === 0) {
      return NextResponse.json({ conversations: [] });
    }

    const conversationIds = participantRows.map(p => p.conversation_id);

    // 2. Fetch all participants for these conversations (for avatars/names)
    const { data: allParticipants, error: allPError } = await supabase
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
      .in('conversation_id', conversationIds)
      .is('left_at', null);

    if (allPError) {
      console.error('GET /api/messages allParticipants error:', allPError);
    }

    // 3. Fetch the last message for each conversation — one limit-1 query per
    // conversation, in parallel. (A single unbounded .in() query silently
    // truncates at PostgREST's 1000-row cap once total message volume grows,
    // making older conversations render "No messages yet".)
    const lastMessageResults = await Promise.all(
      conversationIds.map(cid =>
        supabase
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
          .eq('conversation_id', cid)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      )
    );
    const lastMessages = lastMessageResults
      .map(r => {
        if (r.error) console.error('GET /api/messages lastMessage error:', r.error);
        return r.data;
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    // Group last messages by conversation (first = newest)
    const lastMessageByConv: Record<string, Message> = {};
    for (const msg of (lastMessages || [])) {
      if (!lastMessageByConv[msg.conversation_id]) {
        lastMessageByConv[msg.conversation_id] = msg as unknown as Message;
      }
    }

    // Group participants by conversation
    const participantsByConv: Record<string, ConversationParticipant[]> = {};
    for (const p of (allParticipants || [])) {
      if (!participantsByConv[p.conversation_id]) {
        participantsByConv[p.conversation_id] = [];
      }
      participantsByConv[p.conversation_id].push(p as unknown as ConversationParticipant);
    }

    // 4. Compute unread counts per conversation (parallel instead of sequential)
    const unreadCounts: Record<string, number> = {};
    const unreadPromises = participantRows.map(async (pr) => {
      let query = supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', pr.conversation_id)
        .neq('sender_id', user.id)
        .is('deleted_at', null);

      // Unread floor: the later of last_read_at and joined_at — a newly added
      // group member must not be charged for the conversation's prior history.
      const unreadFloor = pr.last_read_at && pr.last_read_at > pr.joined_at
        ? pr.last_read_at
        : pr.joined_at;
      if (unreadFloor) {
        query = query.gt('created_at', unreadFloor);
      }

      const { count } = await query;
      unreadCounts[pr.conversation_id] = count || 0;
    });
    await Promise.all(unreadPromises);

    // 5. Assemble conversations
    const conversations: Conversation[] = participantRows
      .map(pr => {
        const conv = pr.conversation as unknown as Conversation;
        if (!conv) return null;

        const myParticipant: ConversationParticipant = {
          id: pr.id,
          conversation_id: pr.conversation_id,
          profile_id: pr.profile_id,
          role: pr.role as 'admin' | 'member',
          last_read_at: pr.last_read_at,
          is_muted: pr.is_muted,
          joined_at: pr.joined_at,
          left_at: pr.left_at,
          profile: { id: user.id, first_name: null, last_name: null, full_name: null, avatar_url: null, handle: null },
        };

        return {
          ...conv,
          participants: participantsByConv[conv.id] || [],
          last_message: lastMessageByConv[conv.id] || null,
          unread_count: unreadCounts[conv.id] || 0,
          my_participant: myParticipant,
        } as Conversation;
      })
      .filter((c): c is Conversation => c !== null)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

    return NextResponse.json({ conversations });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('GET /api/messages error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── POST /api/messages ────────────────────────────────────────────────────────
// Create a new conversation (DM or group).
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);
    const body = await request.json();
    const { type, participantId, name, participantIds } = body;

    if (type === 'direct') {
      if (!participantId || !UUID_RE.test(participantId)) {
        return NextResponse.json({ error: 'Valid participantId is required for direct messages' }, { status: 400 });
      }

      if (participantId === user.id) {
        return NextResponse.json({ error: 'Cannot message yourself' }, { status: 400 });
      }

      // Check if blocked — use separate .eq() filters instead of string interpolation
      const { data: blockCheck } = await supabase
        .from('user_blocks')
        .select('id')
        .or(`and(blocker_id.eq.${user.id},blocked_id.eq.${participantId}),and(blocker_id.eq.${participantId},blocked_id.eq.${user.id})`)
        .maybeSingle();

      if (blockCheck) {
        return NextResponse.json({ error: 'Cannot message this user' }, { status: 403 });
      }

      // Check target user's messaging_permission
      const { data: targetProfile } = await supabase
        .from('profiles')
        .select('messaging_permission')
        .eq('id', participantId)
        .single();

      const permission = targetProfile?.messaging_permission || 'everyone';

      if (permission === 'nobody') {
        return NextResponse.json({ error: 'This user is not accepting messages' }, { status: 403 });
      }

      if (permission === 'fans_only') {
        // Sender must be a fan of (follow) the target — "only athletes who
        // follow you can send you messages". (Was inverted: checked that the
        // target follows the sender.)
        const { data: followRecord } = await supabase
          .from('follows')
          .select('id')
          .eq('follower_id', user.id)
          .eq('following_id', participantId)
          .eq('status', 'accepted')
          .maybeSingle();

        if (!followRecord) {
          return NextResponse.json({ error: 'This user only accepts messages from their fans' }, { status: 403 });
        }
      }

      if (permission === 'mutual_fans') {
        const [{ data: follows1 }, { data: follows2 }] = await Promise.all([
          supabase.from('follows').select('id').eq('follower_id', user.id).eq('following_id', participantId).eq('status', 'accepted').maybeSingle(),
          supabase.from('follows').select('id').eq('follower_id', participantId).eq('following_id', user.id).eq('status', 'accepted').maybeSingle(),
        ]);
        if (!follows1 || !follows2) {
          return NextResponse.json({ error: 'This user only accepts messages from mutual fans' }, { status: 403 });
        }
      }

      // Check if a DM already exists between these two users — INCLUDING ones
      // either side previously left (block→unblock, manual leave). Requiring
      // both sides active here used to create a second parallel DM while the
      // other user still saw the old one. Instead, reactivate the old DM.
      const { data: myDirectConvos } = await supabase
        .from('conversation_participants')
        .select(`
          conversation_id,
          left_at,
          conversation:conversations!inner (
            id, type
          )
        `)
        .eq('profile_id', user.id)
        .eq('conversation.type', 'direct');

      if (myDirectConvos && myDirectConvos.length > 0) {
        const convoIds = myDirectConvos.map(c => c.conversation_id);

        // Single query: is the target participant in any of these conversations?
        const { data: match } = await supabase
          .from('conversation_participants')
          .select('conversation_id, left_at')
          .in('conversation_id', convoIds)
          .eq('profile_id', participantId)
          .limit(1)
          .maybeSingle();

        if (match) {
          const mine = myDirectConvos.find(c => c.conversation_id === match.conversation_id);
          if (match.left_at || mine?.left_at) {
            await supabase
              .from('conversation_participants')
              .update({ left_at: null })
              .eq('conversation_id', match.conversation_id)
              .in('profile_id', [user.id, participantId]);
          }
          return NextResponse.json({ conversationId: match.conversation_id, existing: true });
        }
      }

      // Create new DM conversation
      const { data: conv, error: convError } = await supabase
        .from('conversations')
        .insert({ type: 'direct', created_by: user.id })
        .select()
        .single();

      if (convError || !conv) {
        console.error('POST /api/messages create DM error:', convError);
        return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 });
      }

      // Add both participants
      const { error: partError } = await supabase
        .from('conversation_participants')
        .insert([
          { conversation_id: conv.id, profile_id: user.id, role: 'admin' },
          { conversation_id: conv.id, profile_id: participantId, role: 'member' },
        ]);

      if (partError) {
        console.error('POST /api/messages add participants error:', partError);
        await supabase.from('conversations').delete().eq('id', conv.id);
        return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 });
      }

      return NextResponse.json({ conversationId: conv.id, existing: false }, { status: 201 });

    } else if (type === 'group') {
      if (!name?.trim()) {
        return NextResponse.json({ error: 'Group name is required' }, { status: 400 });
      }
      if (!participantIds || !Array.isArray(participantIds) || participantIds.length < 1) {
        return NextResponse.json({ error: 'At least 1 other participant is required' }, { status: 400 });
      }

      // Deduplicate and exclude self
      const otherIds = [...new Set(participantIds.filter((id: string) => id !== user.id))];

      if (otherIds.length === 0) {
        return NextResponse.json({ error: 'At least 1 other participant is required' }, { status: 400 });
      }
      if (otherIds.some((id) => typeof id !== 'string' || !UUID_RE.test(id))) {
        return NextResponse.json({ error: 'Invalid participant id' }, { status: 400 });
      }

      // Enforce blocks + messaging permissions for every member — same rules
      // as DMs. A 2-person "group" is functionally a DM, so group creation
      // must not be a bypass for blocks or messaging_permission.
      const idList = otherIds.join(',');
      const { data: groupBlocks } = await supabase
        .from('user_blocks')
        .select('id')
        .or(`and(blocker_id.eq.${user.id},blocked_id.in.(${idList})),and(blocked_id.eq.${user.id},blocker_id.in.(${idList}))`)
        .limit(1);

      if (groupBlocks && groupBlocks.length > 0) {
        return NextResponse.json({ error: 'Cannot message one or more selected users' }, { status: 403 });
      }

      const [{ data: memberProfiles }, { data: iFollowRows }, { data: followMeRows }] = await Promise.all([
        supabase.from('profiles').select('id, messaging_permission').in('id', otherIds),
        supabase.from('follows').select('following_id').eq('follower_id', user.id).in('following_id', otherIds).eq('status', 'accepted'),
        supabase.from('follows').select('follower_id').eq('following_id', user.id).in('follower_id', otherIds).eq('status', 'accepted'),
      ]);
      const iFollow = new Set((iFollowRows || []).map(f => f.following_id));
      const followsMe = new Set((followMeRows || []).map(f => f.follower_id));

      for (const member of memberProfiles || []) {
        const perm = member.messaging_permission || 'everyone';
        if (
          perm === 'nobody' ||
          (perm === 'fans_only' && !iFollow.has(member.id)) ||
          (perm === 'mutual_fans' && !(iFollow.has(member.id) && followsMe.has(member.id)))
        ) {
          return NextResponse.json({ error: 'One or more selected users are not accepting messages from you' }, { status: 403 });
        }
      }

      const { data: conv, error: convError } = await supabase
        .from('conversations')
        .insert({ type: 'group', name: name.trim(), created_by: user.id })
        .select()
        .single();

      if (convError || !conv) {
        console.error('POST /api/messages create group error:', convError);
        return NextResponse.json({ error: 'Failed to create group' }, { status: 500 });
      }

      const participants = [
        { conversation_id: conv.id, profile_id: user.id, role: 'admin' },
        ...otherIds.map((id: string) => ({ conversation_id: conv.id, profile_id: id, role: 'member' })),
      ];

      const { error: partError } = await supabase
        .from('conversation_participants')
        .insert(participants);

      if (partError) {
        console.error('POST /api/messages add group participants error:', partError);
        await supabase.from('conversations').delete().eq('id', conv.id);
        return NextResponse.json({ error: 'Failed to create group' }, { status: 500 });
      }

      return NextResponse.json({ conversationId: conv.id, existing: false }, { status: 201 });
    }

    return NextResponse.json({ error: 'Invalid conversation type' }, { status: 400 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('POST /api/messages error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
