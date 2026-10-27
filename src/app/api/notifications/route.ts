import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { reportRouteError } from '@/lib/observability/report';

/** notifications_bell_page (284): the page's raw rows (limit + 1), the hidden actors, the unread count. */
type BellPage = { rows?: Array<{ created_at: string; actor: { id?: string } | { id?: string }[] | null } & Record<string, unknown>>; hidden?: string[]; unread_count?: number };

export async function GET(request: NextRequest) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const user = await requireAuth(request);
    const { searchParams } = new URL(request.url);

    const unreadOnly = searchParams.get('unread_only') === 'true';
    const type = searchParams.get('type');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10) || 20, 1), 100);
    const cursor = searchParams.get('cursor'); // created_at timestamp for pagination

    // ONE call (migration 284, trip-count program PR 5): the page — the
    // viewer's rows, the optional unread / type filters, the keyset cursor,
    // newest first, limit + 1 (the extra row answers has_more) — with the
    // actor embed, plus the hidden actors (281) and the unread count. Raw
    // rows; every rule below is the line it always was. Before 284 this was
    // three reads in a row (the page, hidden_authors_for, a HEAD count).
    const { data, error } = await supabaseAdmin.rpc('notifications_bell_page', {
      p_viewer: user.id,
      p_limit: limit,
      p_cursor: cursor,
      p_unread_only: unreadOnly,
      p_type: type,
    });

    if (error) {
      if (error.code === 'PGRST202') {
        // A deploy ahead of migration 284 on this database: say so, cache nothing.
        return NextResponse.json({ error: 'Notifications service updating' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
      }
      reportRouteError('[NOTIFICATIONS API] Error fetching notifications:', error);
      return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 });
    }
    const page = (data ?? {}) as BellPage;
    const notifications = page.rows ?? [];

    // Spec 2 (mig 223): a muted or blocked person's activity leaves the bell.
    const hiddenActors = new Set(page.hidden ?? []);
    const visible = notifications.filter(n => {
      const actor = n.actor as { id?: string } | { id?: string }[] | null;
      const actorId = Array.isArray(actor) ? actor[0]?.id : actor?.id;
      return !actorId || !hiddenActors.has(actorId);
    });
    // Check if there are more results
    const hasMore = notifications.length > limit;
    const results = hasMore ? visible.slice(0, limit) : visible;

    // The unread count (the badge's predicate: the viewer's rows, is_read = false) rode the call.
    const unreadCount = page.unread_count;

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
    if (error instanceof Response) return error;
    reportRouteError('[NOTIFICATIONS API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch notifications' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const user = await requireAuth(request);
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'clear-all') {
      // Delete all notifications for this user
      const { error, count } = await supabaseAdmin
        .from('notifications')
        .delete({ count: 'exact' })
        .eq('user_id', user.id);

      if (error) {
        reportRouteError('[NOTIFICATIONS API] Error clearing all:', error);
        return NextResponse.json({ error: 'Failed to delete notifications' }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        deleted_count: count || 0
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[NOTIFICATIONS API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to delete notifications' },
      { status: 500 }
    );
  }
}
