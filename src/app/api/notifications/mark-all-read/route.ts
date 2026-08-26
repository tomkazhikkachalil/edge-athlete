import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';

export async function PATCH(request: NextRequest) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const user = await requireAuth(request);


    const { error, count } = await supabaseAdmin
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString()
      }, { count: 'exact' })
      .eq('user_id', user.id)
      .eq('is_read', false); // Only update unread notifications

    if (error) {
      console.error('[NOTIFICATIONS API] Error marking all as read:', error);
      return NextResponse.json({ error: 'Failed to mark all as read' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      updated_count: count || 0
    });

  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[NOTIFICATIONS API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to mark all as read' },
      { status: 500 }
    );
  }
}
