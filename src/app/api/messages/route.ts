import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import type { Conversation } from '@/types/messages';
import { enforceRateLimit } from '@/lib/rate-limit';
import { toProxyUrl } from '@/lib/media/proxy-url';

// ── GET /api/messages ─────────────────────────────────────────────────────────
// List all active conversations for the current user, ordered by updated_at DESC.
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);

    // Pagination (migration 127): ?limit (1-50, default 30) + ?cursor (an
    // updated_at instant; conversations strictly OLDER are returned). The
    // +1 overfetch answers has_more; next_cursor = the last returned
    // conversation's updated_at. Additive — a client that sends nothing gets
    // page one and can ignore the new fields.
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '30', 10) || 30, 1), 50);
    const cursorParam = searchParams.get('cursor');
    if (cursorParam && Number.isNaN(Date.parse(cursorParam))) {
      return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });
    }

    // One RPC assembles the page (migrations 124 + 127), replacing the former
    // O(2N) pattern — a last-message query and an unread-count query PER
    // conversation. It returns a jsonb array already ordered updated_at DESC,
    // with participants (+ profiles), last_message (+ sender), unread_count and
    // my_participant. Called with the admin client (the RPC is service_role-only
    // to prevent an IDOR — it trusts its p_user_id, so it must never be
    // reachable directly), always passing the authed caller's OWN id.
    let { data, error } = await supabase.rpc('get_conversation_list', {
      p_user_id: user.id,
      p_limit: limit + 1,
      p_before: cursorParam ?? null,
    });
    let legacyUnpaginated = false;
    if (error && error.code === 'PGRST202') {
      // Pre-127 DB (migrate/deploy skew or CI against the live project): the
      // single-arg 124 shape. Deliver EXACT pre-round behavior — the whole
      // list, has_more false — never a trimmed page whose cursor this
      // function shape can't honor (the sentinel would loop on it).
      ({ data, error } = await supabase.rpc('get_conversation_list', { p_user_id: user.id }));
      legacyUnpaginated = true;
    }
    if (error) {
      console.error('GET /api/messages rpc error:', error);
      return NextResponse.json({ error: 'Failed to load conversations' }, { status: 500 });
    }

    // Proxy the last-message preview media so a private conversation's
    // thumbnail is never a raw public URL. The RPC returns the RAW stored URL;
    // the crypto stays here in app code (as before).
    const page = (data as unknown as Conversation[] | null) || [];
    const hasMore = legacyUnpaginated ? false : page.length > limit;
    const trimmed = hasMore ? page.slice(0, limit) : page;

    const conversations = trimmed.map(c =>
      c.last_message
        ? {
            ...c,
            last_message: {
              ...c.last_message,
              media_url: toProxyUrl(c.last_message.media_url, { type: 'message', id: c.last_message.id }),
            },
          }
        : c
    );

    return NextResponse.json({
      conversations,
      has_more: hasMore,
      next_cursor: hasMore && conversations.length
        ? conversations[conversations.length - 1].updated_at
        : null,
    });
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
    const limited = await enforceRateLimit(request, 'conversation-create', { userId: user.id });
    if (limited) return limited;

    const body = await request.json();
    const { type, participantId, name, participantIds } = body;

    // Supervised senders: their own messaging_permission is SYMMETRIC — it
    // governs who they can exchange messages with, both directions ("who can
    // talk with your child"). Adults are never gated here; recipients keep
    // their own inbound checks below.
    const { data: senderProfile } = await supabase
      .from('profiles')
      .select('supervision_state, messaging_permission')
      .eq('id', user.id)
      .maybeSingle();
    const senderSupervised = senderProfile?.supervision_state === 'supervised';
    const senderPermission = (senderProfile?.messaging_permission || 'everyone') as
      import('@/lib/supervised-gates').MessagingPermission;
    const GUARDIAN_BLOCK_COPY = "Your guardian's messaging setting doesn't allow this conversation.";
    if (senderSupervised && senderPermission === 'nobody') {
      return NextResponse.json({ error: GUARDIAN_BLOCK_COPY }, { status: 403 });
    }

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
        .or(`and(blocker_id.eq.${user.id},blocked_id.eq.${participantId}),and(blocker_id.eq.${participantId},blocked_id.eq.${user.id})`)  // hardening-ok: session UUID + UUID_RE-validated
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

      // Outbound half for a supervised sender (nobody already rejected above).
      if (senderSupervised && senderPermission !== 'everyone') {
        const { outboundAllowed } = await import('@/lib/supervised-gates');
        const [{ data: iFollowRow }, { data: followsMeRow }] = await Promise.all([
          supabase.from('follows').select('id').eq('follower_id', user.id).eq('following_id', participantId).eq('status', 'accepted').maybeSingle(),
          supabase.from('follows').select('id').eq('follower_id', participantId).eq('following_id', user.id).eq('status', 'accepted').maybeSingle(),
        ]);
        if (!outboundAllowed(senderPermission, !!iFollowRow, !!followsMeRow)) {
          return NextResponse.json({ error: GUARDIAN_BLOCK_COPY }, { status: 403 });
        }
      }

      // First-contact hold (Wave 3, mig 131) — runs AFTER the tier and block
      // gates: an unknown account reaching a supervised child gets a held
      // conversation the child can't see until a guardian approves.
      const { applyFirstContactGate, holdChildRow, notifyContactHold } =
        await import('@/lib/first-contact');
      const firstContact = await applyFirstContactGate(supabase, user.id, participantId);

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
          if (firstContact.hold && firstContact.childId) {
            // Revival re-gates (a denied contact's retry lands here): re-hold
            // the child's row, belling the guardians only on the NULL→held
            // transition.
            const { held } = await holdChildRow(
              supabase, match.conversation_id, firstContact.childId, user.id
            );
            return NextResponse.json({
              conversationId: match.conversation_id, existing: true, held,
            });
          }
          // The contact is known (approved/guardian/follow/child-initiated):
          // clear any stale hold so the approval materializes for the child.
          await supabase
            .from('conversation_participants')
            .update({ held_at: null })
            .eq('conversation_id', match.conversation_id)
            .not('held_at', 'is', null);
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

      // Add both participants. A fresh hold can only be on the RECIPIENT
      // (a supervised sender never holds their own conversation — D8).
      const holdRecipient = firstContact.hold && firstContact.childId === participantId;
      const { error: partError } = await supabase
        .from('conversation_participants')
        .insert([
          { conversation_id: conv.id, profile_id: user.id, role: 'admin' },
          {
            conversation_id: conv.id,
            profile_id: participantId,
            role: 'member',
            ...(holdRecipient ? { held_at: new Date().toISOString() } : {}),
          },
        ]);

      if (partError) {
        console.error('POST /api/messages add participants error:', partError);
        await supabase.from('conversations').delete().eq('id', conv.id);
        return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 });
      }

      if (holdRecipient) {
        await notifyContactHold(supabase, participantId, user.id, conv.id);
        return NextResponse.json({ conversationId: conv.id, existing: false, held: true }, { status: 201 });
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
        .or(`and(blocker_id.eq.${user.id},blocked_id.in.(${idList})),and(blocked_id.eq.${user.id},blocker_id.in.(${idList}))`)  // hardening-ok: session UUID + DB-sourced UUID list
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

      // Outbound half for a supervised sender — reuses the follow sets just
      // computed (nobody already rejected above).
      if (senderSupervised && senderPermission !== 'everyone') {
        const { outboundAllowed } = await import('@/lib/supervised-gates');
        for (const id of otherIds) {
          if (!outboundAllowed(senderPermission, iFollow.has(id), followsMe.has(id))) {
            return NextResponse.json({ error: GUARDIAN_BLOCK_COPY }, { status: 403 });
          }
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
