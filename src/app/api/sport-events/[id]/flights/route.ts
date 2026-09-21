import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
import { bodyProfileId, readJson, resolveActor } from '@/lib/sport-events/actor-server';
import { parseFlightsPlan } from '@/lib/sport-events/flights';
import { fetchSportEventView } from '@/lib/sport-events/view-server';
import { reportRouteError } from '@/lib/observability/report';

/**
 * PUT {assignments: [{participant_id, flight | null}]} — the organizer's
 * flights for the event's accepted, playing players (Events program,
 * phase 2): the whole plan in one call, each id once; a player left out
 * keeps their flight; null clears one. Refused after completion (the
 * results are frozen with the roster). Everyone named must be an
 * accepted, playing participant — a miss names the entry.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  try {
    const { user, error: authError } = await getServerAuth(request);
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const limited = await enforceRateLimit(request, 'sport-event', { userId: user.id });
    if (limited) return limited;
    const body = await readJson(request);
    const actor = await resolveActor(user.id, bodyProfileId(body));
    if (!actor.ok) return actor.response;

    const admin = getSupabaseAdmin();
    const read = await readSportEventAccess(admin, id, actor.profileId, null);
    if (!read) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (!read.access.canManage) return NextResponse.json({ error: 'Only an organizer can set the flights.' }, { status: 403 });
    if (read.event.status === 'completed' || read.event.status === 'cancelled') return NextResponse.json({ error: 'The event is over — the flights are frozen with the results.' }, { status: 409 });

    const { data: eligible } = await admin.from('sport_event_participants').select('id').eq('sport_event_id', id).eq('status', 'accepted').eq('playing', true).neq('role', 'follower');
    const plan = parseFlightsPlan(body, new Set(((eligible ?? []) as Array<{ id: string }>).map(r => r.id)));
    if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 400 });

    for (const a of plan.value) {
      const { error } = await admin.from('sport_event_participants').update({ flight: a.flight }).eq('id', a.participant_id).eq('sport_event_id', id);
      if (error) {
        reportRouteError('[api/sport-events/flights] update failed:', error);
        return NextResponse.json({ error: 'Could not save the flights' }, { status: 500 });
      }
    }
    const view = await fetchSportEventView(admin, id, actor.profileId, null);
    return NextResponse.json(view, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    reportRouteError('[api/sport-events/flights] PUT error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
