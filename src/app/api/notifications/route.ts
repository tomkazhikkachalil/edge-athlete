import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth-server';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const { searchParams } = new URL(request.url);

    const unreadOnly = searchParams.get('unread_only') === 'true';
    const type = searchParams.get('type');
    const limit = parseInt(searchParams.get('limit') || '20');
    const cursor = searchParams.get('cursor'); // created_at timestamp for pagination

    // Build query
    let query = supabaseAdmin
      .from('notifications')
      .select(`
        id,
        type,
        title,
        message,
        action_url,
        is_read,
        read_at,
        created_at,
        metadata,
        post_id,
        comment_id,
        follow_id,
        actor:actor_id (
          id,
          first_name,
          middle_name,
          last_name,
          full_name,
          avatar_url,
          handle
        )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit + 1); // Fetch one extra to check if there are more

    // Apply filters
    if (unreadOnly) {
      query = query.eq('is_read', false);
    }

    if (type) {
      query = query.eq('type', type);
    }

    if (cursor) {
      query = query.lt('created_at', cursor);
    }

    const { data: notifications, error } = await query;

    if (error) {
      console.error('[NOTIFICATIONS API] Error fetching notifications:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Check if there are more results
    const hasMore = notifications && notifications.length > limit;
    const results = hasMore ? notifications.slice(0, limit) : notifications || [];

    // Get unread count
    const { count: unreadCount } = await supabaseAdmin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_read', false);

    // Determine next cursor
    const nextCursor = hasMore && results.length > 0
      ? results[results.length - 1].created_at
      : null;

    return NextResponse.json({
      notifications: results,
      unread_count: unreadCount || 0,
      has_more: hasMore,
      next_cursor: nextCursor
    });

  } catch (error) {
    console.error('[NOTIFICATIONS API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch notifications' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'clear-all') {
      // Delete all notifications for this user
      const { error, count } = await supabaseAdmin
        .from('notifications')
        .delete()
        .eq('user_id', user.id);

      if (error) {
        console.error('[NOTIFICATIONS API] Error clearing all:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        deleted_count: count || 0
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    console.error('[NOTIFICATIONS API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete notifications' },
      { status: 500 }
    );
  }
}
