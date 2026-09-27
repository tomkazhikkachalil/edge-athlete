import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { listSchedulableOrgs } from '@/lib/calendar/schedulable-server';
import { reportRouteError } from '@/lib/observability/report';

/**
 * GET /api/calendar/schedulable-scopes — where the signed-in person may put
 * an event (teams & divisions leftovers 2): per org, whether the WHOLE org
 * (owners / managers) and exactly the divisions and teams they may schedule
 * (a coach's own team, a division grant's teams). The calendar's event form
 * reads it; the event routes re-decide on write. Viewer-dependent, so never
 * a shared cache.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const orgs = await listSchedulableOrgs(getSupabaseAdmin(), user.id);
    return NextResponse.json({ orgs }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[SCHEDULABLE SCOPES] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
