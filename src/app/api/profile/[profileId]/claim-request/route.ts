import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { resolveActingProfile } from '@/lib/guardian-gate';
import { parseFor } from '@/lib/sport-profile/unclaimed';
import { requestProfileClaim } from '@/lib/sport-profile/unclaimed-server';
import { reportRouteError } from '@/lib/observability/report';

const PRIVATE = { 'Cache-Control': 'private, no-store' };

/**
 * POST /api/profile/[profileId]/claim-request[?for=<profile id>] — "this is
 * me — request this profile" (migration 312; Tom, Nov 15 2026: claiming is a
 * process the person starts from the unclaimed page). The film goes to the
 * person asking, or to the child their guardian asks for (`?for=`, the one
 * acting-as gate). The organization that tagged the games decides; asking
 * again while a request is open is the same request. 201 {id, status}.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    const { profileId } = await params;
    if (!isUuid(profileId)) return NextResponse.json({ error: 'Profile not found' }, { status: 404, headers: PRIVATE });
    const { user, error: authError, limited } = await getServerAuth(request, { limit: 'settings-write' });
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (limited) return limited;
    const asked = parseFor(request.nextUrl.searchParams.get('for'));
    if (!asked.ok) return NextResponse.json({ error: asked.error }, { status: 400, headers: PRIVATE });
    const acting = await resolveActingProfile(user.id, asked.forId, 'Only the athlete or their guardian can ask for this');
    if (!acting.ok) return NextResponse.json({ error: acting.error }, { status: acting.status, headers: PRIVATE });
    const made = await requestProfileClaim(getSupabaseAdmin(), profileId, acting.actorId, user.id);
    if (!made.ok) return NextResponse.json({ error: made.error }, { status: made.status, headers: PRIVATE });
    return NextResponse.json(made.value, { status: 201, headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/profile/claim-request] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
