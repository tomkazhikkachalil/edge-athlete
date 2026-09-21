import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin, activeWriterRefusal } from '@/lib/auth-server';
import { filterBlockedBidirectional } from '@/lib/blocks';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
import { bodyProfileId, readJson, resolveActor } from '@/lib/sport-events/actor-server';
import { applyJoin } from '@/lib/sport-events/join-server';
import { reportRouteError } from '@/lib/observability/report';

/**
 * POST ?token= — one-tap Join (Events program, phase 4; `join_mode: 'open'`,
 * 214). Any signed-in person who may see the event seats themselves while
 * it is open — capacity waitlists, a follower row converts, a removed row
 * stays out (`planJoin('join')`). A block between the joiner and the host
 * answers 409 without saying who blocked whom (the invite route's rule).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  try {
    const { user, error: authError } = await getServerAuth(request);
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const refusal = await activeWriterRefusal(user.id);
    if (refusal) return refusal;
    const limited = await enforceRateLimit(request, 'sport-event-join', { userId: user.id });
    if (limited) return limited;
    const actor = await resolveActor(user.id, bodyProfileId(await readJson(request)));
    if (!actor.ok) return actor.response;
    const admin = getSupabaseAdmin();
    const read = await readSportEventAccess(admin, id, actor.profileId, new URL(request.url).searchParams.get('token'));
    if (!read) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (read.event.host_profile_id !== actor.profileId) {
      const blocks = await filterBlockedBidirectional(admin, actor.profileId, [read.event.host_profile_id]);
      if (blocks.allowed.length === 0) return NextResponse.json({ error: "You can't join this event." }, { status: 409 });
    }
    const outcome = await applyJoin(admin, { event: read.event, access: read.access, action: 'join', actorProfileId: actor.profileId });
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ participant: outcome.participant }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    reportRouteError('[api/sport-events/participants/join] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
