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

    // 3. Fetch last message for each conversation
    const { data: lastMessages, error: lmError } = await supabase
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
      .in('conversation_id', conversationIds)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (lmError) {
      console.error('GET /api/messages lastMessages error:', lmError);
    }

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

      if (pr.last_read_at) {
        query = query.gt('created_at', pr.last_read_at);
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
        // Check if user is a fan of (follows) the target
        const { data: followRecord } = await supabase
          .from('follows')
          .select('id')
          .eq('follower_id', participantId)
          .eq('following_id', user.id)
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

      // Check if DM already exists between these two users.
      // Fetch ALL direct conversations the current user is in, then check each.
      const { data: myDirectConvos } = await supabase
        .from('conversation_participants')
        .select(`
          conversation_id,
          conversation:conversations!inner (
            id, type
          )
        `)
        .eq('profile_id', user.id)
        .is('left_at', null)
        .eq('conversation.type', 'direct');

      if (myDirectConvos && myDirectConvos.length > 0) {
        const convoIds = myDirectConvos.map(c => c.conversation_id);

        // Single query: is the target participant in any of these conversations?
        const { data: match } = await supabase
          .from('conversation_participants')
          .select('conversation_id')
          .in('conversation_id', convoIds)
          .eq('profile_id', participantId)
          .is('left_at', null)
          .limit(1)
          .maybeSingle();

        if (match) {
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
