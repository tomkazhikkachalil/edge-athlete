import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { requireAuth, requireProfileRole, getSupabaseAdmin } from '@/lib/auth-server';

// Round I: every method takes an optional targetProfileId — a guardian
// managing their supervised athlete's block list. The role matrix gates it
// (owner passes for self, guardian for the child); all queries anchor to the
// RESOLVED profile so the block always belongs to the person being protected.
async function resolveBlocker(
  request: NextRequest,
  userId: string,
  targetProfileId: unknown
): Promise<string> {
  if (
    typeof targetProfileId === 'string' &&
    targetProfileId &&
    targetProfileId !== userId
  ) {
    await requireProfileRole(request, targetProfileId, 'manage_privacy');
    return targetProfileId;
  }
  return userId;
}

// ── GET /api/messages/block ───────────────────────────────────────────────────
// The block list (own, or a managed athlete's via ?profileId=). Until Round I
// there was NO list surface anywhere — DELETE was dead code.
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);
    const { searchParams } = new URL(request.url);
    const blockerId = await resolveBlocker(request, user.id, searchParams.get('profileId'));

    const { data, error } = await supabase
      .from('user_blocks')
      .select(`
        id,
        created_at,
        blocked:blocked_id (id, first_name, middle_name, last_name, full_name, avatar_url, handle)
      `)
      .eq('blocker_id', blockerId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('GET /api/messages/block error:', error);
      return NextResponse.json({ error: 'Could not load blocked users' }, { status: 500 });
    }
    return NextResponse.json({ blocks: data ?? [] });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('GET /api/messages/block error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── POST /api/messages/block ──────────────────────────────────────────────────
// Block a user: insert into user_blocks and close any DM between them.
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);
    const body = await request.json();
    const { blockedId } = body;
    const blockerId = await resolveBlocker(request, user.id, body.targetProfileId);

    if (!blockedId || typeof blockedId !== 'string' || !UUID_RE.test(blockedId)) {
      return NextResponse.json({ error: 'Valid blockedId is required' }, { status: 400 });
    }
    if (blockedId === blockerId) {
      return NextResponse.json({ error: 'Cannot block yourself' }, { status: 400 });
    }

    // Insert block (ignore if already blocked)
    const { error: blockError } = await supabase
      .from('user_blocks')
      .upsert({ blocker_id: blockerId, blocked_id: blockedId }, { onConflict: 'blocker_id,blocked_id' });

    if (blockError) {
      console.error('POST /api/messages/block insert error:', blockError);
      return NextResponse.json({ error: 'Failed to block user' }, { status: 500 });
    }

    // Blocks gate follows (Aug 2026): sever any existing follow relationship
    // in BOTH directions — accepted edges AND pending requests. Without this
    // a blocked follower kept feed/private access, which is the actual harm
    // blocking exists to stop. Best-effort: the block row is the contract.
    try {
      const { data: severed } = await supabase
        .from('follows')
        .delete()
        .or(`and(follower_id.eq.${blockerId},following_id.eq.${blockedId}),and(follower_id.eq.${blockedId},following_id.eq.${blockerId})`)
        .select('id');
      if (severed && severed.length > 0) {
        console.log(`[block] severed ${severed.length} follow edge(s)`);
      }
    } catch (severError) {
      console.error('[block] follow teardown failed (non-fatal):', severError);
    }

    // Find any DM conversation between these two users and close both participants
    const { data: myParticipants } = await supabase
      .from('conversation_participants')
      .select(`
        conversation_id,
        conversation:conversations!inner (type)
      `)
      .eq('profile_id', blockerId)
      .eq('conversation.type', 'direct')
      .is('left_at', null);

    if (myParticipants && myParticipants.length > 0) {
      const convIds = myParticipants.map(p => p.conversation_id);

      // Check which of those also contains the blocked user
      const { data: sharedConvs } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .in('conversation_id', convIds)
        .eq('profile_id', blockedId)
        .is('left_at', null);

      if (sharedConvs && sharedConvs.length > 0) {
        const dmConvIds = sharedConvs.map(p => p.conversation_id);
        await supabase
          .from('conversation_participants')
          .update({ left_at: new Date().toISOString() })
          .in('conversation_id', dmConvIds)
          .in('profile_id', [blockerId, blockedId]);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('POST /api/messages/block error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── DELETE /api/messages/block ────────────────────────────────────────────────
// Unblock a user.
export async function DELETE(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);
    const { searchParams } = new URL(request.url);
    const blockedId = searchParams.get('blockedId');
    const blockerId = await resolveBlocker(request, user.id, searchParams.get('targetProfileId'));

    if (!blockedId || typeof blockedId !== 'string' || !UUID_RE.test(blockedId)) {
      return NextResponse.json({ error: 'Valid blockedId is required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('user_blocks')
      .delete()
      .eq('blocker_id', blockerId)
      .eq('blocked_id', blockedId);

    if (error) {
      return NextResponse.json({ error: 'Failed to unblock user' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('DELETE /api/messages/block error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
