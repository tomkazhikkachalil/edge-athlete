import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { isUuid } from '@/lib/uuid';
import { reportRouteError } from '@/lib/observability/report';
import { countActivities, decodeCursor, listActivities, readWeeklyTotals, resolveActivityAccess } from '@/lib/activities/read-server';

/**
 * GET /api/profile/[profileId]/activities — the profile's Activities tab.
 *
 * ?cursor=<opaque> pages the list (20, newest first); the first page also
 * carries the count and the last 12 weeks of totals. The gate is the
 * activity readers' ONE gate (read-server.ts resolveActivityAccess — the
 * route calls canViewProfile through it); "Only me" activities are the
 * owner's. `isOwner` tells the tab to offer Import. Viewer-dependent, so
 * never a shared cache: `private, no-store` (the /u/ payload is CDN-cached
 * STRANGER_VIEW; this tab fetches its own, like Vitals).
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    const { profileId } = await params;
    if (!isUuid(profileId)) return NextResponse.json({ error: 'Profile not found' }, { status: 404, headers: NO_STORE });
    const { user } = await getServerAuth(request);
    const admin = getSupabaseAdmin();
    const access = await resolveActivityAccess(admin, user?.id ?? null, profileId);
    if (!access.ok) return NextResponse.json({ error: 'Profile not found' }, { status: 404, headers: NO_STORE });

    const url = new URL(request.url);
    const rawCursor = url.searchParams.get('cursor');
    const cursor = decodeCursor(rawCursor);
    if (rawCursor && !cursor) return NextResponse.json({ error: 'Invalid cursor' }, { status: 400, headers: NO_STORE });

    const today = new Date().toISOString().slice(0, 10);
    const [list, totals, count] = await Promise.all([
      listActivities(admin, profileId, access.audience, cursor),
      cursor ? Promise.resolve(null) : readWeeklyTotals(admin, profileId, access.audience, today),
      cursor ? Promise.resolve(null) : countActivities(admin, profileId, access.audience),
    ]);
    if (!list.ok) return NextResponse.json({ error: 'Could not load activities' }, { status: 500, headers: NO_STORE });
    return NextResponse.json(
      { items: list.items, next: list.next, totals, count, isOwner: access.audience === 'owner' },
      { headers: NO_STORE }
    );
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[profile/activities] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
