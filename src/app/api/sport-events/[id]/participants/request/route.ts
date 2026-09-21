import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
import { bodyProfileId, readJson, resolveActor } from '@/lib/sport-events/actor-server';
import { applyJoin } from '@/lib/sport-events/join-server';
import { reportRouteError } from '@/lib/observability/report';

/**
 * POST ?token= — ask to join (open events under `join_mode: 'request'`;
 * the viewer must be able to see the event — a link event needs its
 * token). The host and co-organizers get the bell. An invited player who
 * requests simply accepts.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  try {
    const { user, error: authError } = await getServerAuth(request);
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const limited = await enforceRateLimit(request, 'sport-event-join', { userId: user.id });
    if (limited) return limited;
    const actor = await resolveActor(user.id, bodyProfileId(await readJson(request)));
    if (!actor.ok) return actor.response;
    const admin = getSupabaseAdmin();
    const read = await readSportEventAccess(admin, id, actor.profileId, new URL(request.url).searchParams.get('token'));
    if (!read) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    const outcome = await applyJoin(admin, { event: read.event, access: read.access, action: 'request', actorProfileId: actor.profileId });
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ participant: outcome.participant }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    reportRouteError('[api/sport-events/participants/request] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
