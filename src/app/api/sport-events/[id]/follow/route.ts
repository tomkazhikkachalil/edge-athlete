import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
import { bodyProfileId, readJson, resolveActor } from '@/lib/sport-events/actor-server';
import { applyJoin } from '@/lib/sport-events/join-server';
import type { JoinAction } from '@/lib/sport-events/join';
import { reportRouteError } from '@/lib/observability/report';

/** POST / DELETE ?token= — follow / unfollow an event you can see. A follower never takes a seat. */
async function handle(request: NextRequest, id: string, action: JoinAction) {
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  try {
    const { user, error: authError } = await getServerAuth(request);
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const limited = await enforceRateLimit(request, 'sport-event-join', { userId: user.id });
    if (limited) return limited;
    const url = new URL(request.url);
    const actor = await resolveActor(user.id, action === 'follow' ? bodyProfileId(await readJson(request)) : url.searchParams.get('as'));
    if (!actor.ok) return actor.response;
    const admin = getSupabaseAdmin();
    const read = await readSportEventAccess(admin, id, actor.profileId, url.searchParams.get('token'));
    if (!read) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    const outcome = await applyJoin(admin, { event: read.event, access: read.access, action, actorProfileId: actor.profileId });
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ following: action === 'follow', participant: outcome.participant }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    reportRouteError('[api/sport-events/follow] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(request, id, 'follow');
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(request, id, 'unfollow');
}
