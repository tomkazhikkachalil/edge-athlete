import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth-server';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireAuth(request);


    const { error, count } = await supabaseAdmin
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString()
      })
      .eq('user_id', user.id)
      .eq('is_read', false); // Only update unread notifications

    if (error) {
      console.error('[NOTIFICATIONS API] Error marking all as read:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      updated_count: count || 0
    });

  } catch (error) {
    console.error('[NOTIFICATIONS API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to mark all as read' },
      { status: 500 }
    );
  }
}
