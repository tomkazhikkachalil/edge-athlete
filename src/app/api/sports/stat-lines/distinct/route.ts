import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { resolveActingProfile } from '@/lib/guardian-gate';
import { setDistinctPair } from '@/lib/performance/game-distinct-server';
import { parseDistinctBody } from '@/lib/performance/same-game';
import { getStatSchema } from '@/lib/sports/stat-schemas';
import { reportRouteError } from '@/lib/observability/report';

const PRIVATE = { 'Cache-Control': 'private, no-store' };

/**
 * POST /api/sports/stat-lines/distinct[?profileId=…] {sport, a, b, distinct}
 * — "these are two different games" (migration 309, Nov 14 2026). The
 * same-game rule counts two games of one date as one; the athlete, or their
 * guardian (`?profileId=`, the one acting-as gate), says a pair is a
 * doubleheader and both count — or takes it back (`distinct: false`). It is
 * about YOUR OWN stats only; a pair tied by a contest is never split (the
 * rule does not ask). 200 {ok}.
 */
export async function POST(request: NextRequest) {
  try {
    const { user, error: authError, limited } = await getServerAuth(request, { limit: 'settings-write' });
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (limited) return limited;
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const parsed = parseDistinctBody(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: PRIVATE });
    if (!getStatSchema(parsed.value.sport)) return NextResponse.json({ error: 'Unknown or unsupported sport' }, { status: 400, headers: PRIVATE });
    const acting = await resolveActingProfile(user.id, request.nextUrl.searchParams.get('profileId'), 'Only the athlete or their guardian can say this');
    if (!acting.ok) return NextResponse.json({ error: acting.error }, { status: acting.status, headers: PRIVATE });
    const saved = await setDistinctPair(getSupabaseAdmin(), acting.actorId, user.id, parsed.value);
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: saved.status, headers: PRIVATE });
    return NextResponse.json({ ok: true }, { headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/sports/stat-lines/distinct] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
