import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
import { bodyProfileId, readJson, resolveActor } from '@/lib/sport-events/actor-server';
import { mintLinkToken } from '@/lib/sport-events/link-token';
import { reportRouteError } from '@/lib/observability/report';

/** POST — rotate a link event's token (the host only). Every old link stops working. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  try {
    const { user, error: authError } = await getServerAuth(request);
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const limited = await enforceRateLimit(request, 'sport-event', { userId: user.id });
    if (limited) return limited;
    const actor = await resolveActor(user.id, bodyProfileId(await readJson(request)));
    if (!actor.ok) return actor.response;
    const admin = getSupabaseAdmin();
    const read = await readSportEventAccess(admin, id, actor.profileId, null);
    if (!read) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (!read.access.canDelete) return NextResponse.json({ error: 'Only the host can rotate the link.' }, { status: 403 });
    if (read.event.visibility !== 'link') return NextResponse.json({ error: 'This event is not shared by link.' }, { status: 409 });
    const link_token = mintLinkToken();
    const { error } = await admin.from('sport_events').update({ link_token }).eq('id', id);
    if (error) {
      reportRouteError('[api/sport-events/link-token] rotate failed:', error);
      return NextResponse.json({ error: 'Could not rotate the link' }, { status: 500 });
    }
    return NextResponse.json({ link_token }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    reportRouteError('[api/sport-events/link-token] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
