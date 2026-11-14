import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { parseClaimRequest } from '@/lib/videos/tag-claims';
import { resolveActingProfile } from '@/lib/guardian-gate';
import { claimTargets, guardedAthletes, myClaim, pendingClaims, requestClaim } from '@/lib/videos/video-claims-server';
import { readVideoForViewer } from '@/lib/videos/videos-server';
import { reportRouteError } from '@/lib/observability/report';

const PRIVATE = { 'Cache-Control': 'private, no-store' };
const NOT_FOUND = () => NextResponse.json({ error: 'Video not found' }, { status: 404, headers: PRIVATE });

/**
 * "This is me" on a game (round 2 PR 4, Nov 13 2026; migration 308). The
 * rights are the VIDEO's: whoever may see it may ask; its managers decide.
 *
 * GET → a manager: {can_manage: true, claims, targets} (the open requests and
 * what can be linked); anyone else signed in: {can_manage: false, mine,
 * athletes} — `athletes` are the ones they guard, each with its own request
 * and whether it is already tagged here.
 * POST[?profileId=] {name?} → 201 {claim}: the caller asks to be linked — or
 * a guardian asks for a supervised athlete (the one acting-as gate). Asking again
 * while a request is open returns that request. A request changes nothing
 * until a manager approves it.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NOT_FOUND();
  try {
    const { user, error: authError } = await getServerAuth(request);
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const admin = getSupabaseAdmin();
    const read = await readVideoForViewer(admin, id, user);
    if (!read) return NOT_FOUND();
    if (!read.canManage) {
      const wards = await guardedAthletes(admin, user.id);
      const athletes = await Promise.all(wards.map(async w => ({ ...w, mine: await myClaim(admin, id, w.id), tagged: read.highlights.some(h => h.people.some(p => p.profile_id === w.id)) })));
      return NextResponse.json({ can_manage: false, mine: await myClaim(admin, id, user.id), athletes }, { headers: PRIVATE });
    }
    const [claims, targets] = await Promise.all([pendingClaims(admin, id), claimTargets(admin, read.highlights)]);
    return NextResponse.json({ can_manage: true, claims, targets }, { headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/videos/id/claims] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NOT_FOUND();
  try {
    const { user, error: authError, limited } = await getServerAuth(request, { limit: 'video-write' });
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (limited) return limited;
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const parsed = parseClaimRequest(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: PRIVATE });
    const admin = getSupabaseAdmin();
    const read = await readVideoForViewer(admin, id, user);
    if (!read) return NOT_FOUND();
    const acting = await resolveActingProfile(user.id, request.nextUrl.searchParams.get('profileId'), 'Only the athlete or their guardian can ask this');
    if (!acting.ok) return NextResponse.json({ error: acting.error }, { status: acting.status, headers: PRIVATE });
    const made = await requestClaim(admin, { id, title: read.row.title ?? null, created_by_user_id: read.row.created_by_user_id ?? null }, acting.actorId, user.id, parsed.value.askedName);
    if (!made.ok) return NextResponse.json({ error: made.error }, { status: made.status, headers: PRIVATE });
    return NextResponse.json({ claim: made.value }, { status: 201, headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/videos/id/claims] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
