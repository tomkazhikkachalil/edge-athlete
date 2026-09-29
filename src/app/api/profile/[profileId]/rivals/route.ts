import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getProfileRole, getServerAuth, getSupabaseAdmin, requireAuth, requireProfileRole } from '@/lib/auth-server';
import { canViewProfile } from '@/lib/privacy';
import { resolveProfileAction } from '@/lib/profile-roles';
import { SPORT_NAMES } from '@/lib/config/sports-config';
import { readRivals, setRivalDisplay } from '@/lib/play/rivals-server';
import { reportRouteError } from '@/lib/observability/report';

/**
 * /api/profile/[profileId]/rivals — head-to-head records in one sport (the
 * Play program, 244). GET ?sport=<key>: the athlete (or a guardian) sees
 * every rival with a Show / Hide toggle; anyone else who may view the
 * profile sees only the rivals the athlete chose to show, plus their OWN
 * record against the athlete. A viewer who may not view the profile gets
 * the empty answer. Viewer-dependent → `private, no-store`.
 *
 * PUT { opponentId, sportKey, shown }: the athlete's choice — owner or
 * guardian (`manage_settings`; a supervised athlete's guardian decides).
 */

const HEADERS = { 'Cache-Control': 'private, no-store' };
const isSport = (v: unknown): v is string => typeof v === 'string' && Object.prototype.hasOwnProperty.call(SPORT_NAMES, v);

export async function GET(request: NextRequest, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    const { profileId } = await params;
    const sport = request.nextUrl.searchParams.get('sport');
    if (!isUuid(profileId) || !isSport(sport)) {
      return NextResponse.json({ error: 'A profile and a sport are required' }, { status: 400 });
    }
    const { user } = await getServerAuth(request);
    const viewerId = user?.id ?? null;
    const admin = getSupabaseAdmin();
    // Self holds no profile_access row unless supervised (the self row is
    // 'supervised'); no row on self = the owner (the followers route's rule).
    const role = viewerId ? (await getProfileRole(viewerId, profileId)) ?? (viewerId === profileId ? 'owner' : null) : null;
    const selfView = role === 'owner' || role === 'guardian' || role === 'supervised';
    const empty = NextResponse.json({ selfView: false, canManage: false, rivals: [], yours: null }, { headers: HEADERS });

    if (!selfView) {
      const { data: target } = await admin.from('profiles').select('visibility, departed_at').eq('id', profileId).maybeSingle();
      if (!target || target.departed_at) return empty;
      if (target.visibility !== 'public') {
        const { canView } = await canViewProfile(profileId, viewerId);
        if (!canView) return empty;
      }
    }
    const view = await readRivals(admin, profileId, sport, { id: viewerId, selfView, canManage: resolveProfileAction(role, 'manage_settings') });
    return NextResponse.json(view, { headers: HEADERS });
  } catch (error) {
    reportRouteError('GET rivals error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    const { profileId } = await params;
    if (!isUuid(profileId)) return NextResponse.json({ error: 'Invalid profile' }, { status: 400 });
    // The athlete's choice: self (unless supervised — their guardian decides),
    // or a guardian through the role matrix.
    const user = await requireAuth(request);
    if (user.id === profileId) {
      if ((await getProfileRole(user.id, profileId)) === 'supervised') {
        return NextResponse.json({ error: 'Your guardian chooses which rivals show.' }, { status: 403 });
      }
    } else {
      await requireProfileRole(request, profileId, 'manage_settings');
    }
    const body = (await request.json().catch(() => null)) as { opponentId?: unknown; sportKey?: unknown; shown?: unknown } | null;
    if (!body || typeof body.opponentId !== 'string' || !isUuid(body.opponentId) || body.opponentId === profileId || !isSport(body.sportKey) || typeof body.shown !== 'boolean') {
      return NextResponse.json({ error: 'opponentId, sportKey and shown are required' }, { status: 400 });
    }
    const out = await setRivalDisplay(getSupabaseAdmin(), profileId, body.opponentId, body.sportKey, body.shown);
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json({ ok: true }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('PUT rivals error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
