import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { isUuid } from '@/lib/uuid';
import { reportRouteError } from '@/lib/observability/report';
import { countActivities, decodeCursor, listActivities, listActivitySessions, readWeeklyTotals, resolveActivityAccess } from '@/lib/activities/read-server';
import { aspectHidden } from '@/lib/vitals-privacy';
import { fetchVitalsPrivacy } from '@/lib/vitals-privacy-server';

/**
 * GET /api/profile/[profileId]/activities — the profile's activities, which
 * live inside VITALS since Oct 1 2026 (they were their own tab).
 *
 * ?sessions=1 answers the Vitals week maths instead of a page: every
 * activity of the last year as { id, type, name, startedAt, elapsedS,
 * movingS, distanceM } — what the bars, the streak and the active-days ring
 * count alongside workouts.
 *
 * VITALS PRIVACY applies to both forms: an athlete who hides Vitals, or its
 * Workouts aspect, hides this listing from everyone but themselves and their
 * guardians (`hidden: true`, the workouts route's own answer). A single
 * activity's page keeps the activity gate alone — a post the athlete shared
 * must still open.
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
    const isOwner = access.audience === 'owner';
    const wantsSessions = url.searchParams.get('sessions') === '1';
    if (!isOwner && aspectHidden(await fetchVitalsPrivacy(admin, profileId), 'workouts', isOwner)) {
      return NextResponse.json(
        wantsSessions ? { sessions: [], hidden: true } : { items: [], next: null, totals: [], count: 0, isOwner: false, hidden: true },
        { headers: NO_STORE }
      );
    }
    if (wantsSessions) {
      const read = await listActivitySessions(admin, profileId, access.audience);
      if (!read.ok) return NextResponse.json({ error: 'Could not load activities' }, { status: 500, headers: NO_STORE });
      return NextResponse.json({ sessions: read.sessions }, { headers: NO_STORE });
    }
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
      { items: list.items, next: list.next, totals, count, isOwner },
      { headers: NO_STORE }
    );
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[profile/activities] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
