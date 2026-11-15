import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { parseDecision } from '@/lib/sport-profile/unclaimed';
import { decideProfileClaim } from '@/lib/sport-profile/unclaimed-server';
import { reportRouteError } from '@/lib/observability/report';

const PRIVATE = { 'Cache-Control': 'private, no-store' };

/**
 * PATCH /api/profile/[profileId]/claim-request/[requestId] {action} — the
 * organization answers a request for a placeholder's film (migration 312).
 * `approve` moves the placeholder's tags on that organization's videos to
 * the requester; `decline` tells them. Only someone who manages the
 * organization's videos (a 404 for anyone else — never that a request
 * exists); an answered request is a 409. 200 {status, linked}.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ profileId: string; requestId: string }> }) {
  try {
    const { profileId, requestId } = await params;
    if (!isUuid(profileId) || !isUuid(requestId)) return NextResponse.json({ error: 'Request not found' }, { status: 404, headers: PRIVATE });
    const { user, error: authError, limited } = await getServerAuth(request, { limit: 'settings-write' });
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (limited) return limited;
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const parsed = parseDecision(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: PRIVATE });
    const decided = await decideProfileClaim(getSupabaseAdmin(), profileId, requestId, parsed.action, user.id);
    if (!decided.ok) return NextResponse.json({ error: decided.error }, { status: decided.status, headers: PRIVATE });
    return NextResponse.json(decided.value, { headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/profile/claim-request] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
