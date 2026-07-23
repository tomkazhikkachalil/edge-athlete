import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);

    // Count messages in active conversations where created_at > last_read_at
    // and sender is not the current user
    const { data, error } = await supabase.rpc('get_unread_message_count', {
      p_user_id: user.id,
    });

    if (error) {
      // Fallback: manual count if RPC doesn't exist yet
      const { data: participants } = await supabase
        .from('conversation_participants')
        .select('conversation_id, last_read_at, joined_at')
        .eq('profile_id', user.id)
        .is('left_at', null);

      if (!participants || participants.length === 0) {
        return NextResponse.json({ count: 0 });
      }

      let total = 0;
      for (const p of participants) {
        let query = supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('conversation_id', p.conversation_id)
          .neq('sender_id', user.id)
          .is('deleted_at', null);

        // Floor at the later of last_read_at / joined_at (mirrors the RPC in
        // migration 026): new group members aren't charged for prior history.
        const unreadFloor = p.last_read_at && p.last_read_at > p.joined_at
          ? p.last_read_at
          : p.joined_at;
        if (unreadFloor) {
          query = query.gt('created_at', unreadFloor);
        }

        const { count } = await query;
        total += count || 0;
      }

      return NextResponse.json({ count: total });
    }

    return NextResponse.json({ count: data ?? 0 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('GET /api/messages/unread-count error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
