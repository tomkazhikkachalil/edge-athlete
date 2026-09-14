import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
import { bodyProfileId, readJson, resolveActor } from '@/lib/sport-events/actor-server';
import { snapshotRound, writeStartsOn } from '@/lib/sport-events/rounds-server';
import { parseRoundInput } from '@/lib/sport-events/validate';
import { fetchSportEventView } from '@/lib/sport-events/view-server';

/** PUT — replace a round's plan (date, course, tee, holes, start) while draft / open; re-snapshots the catalog and rewrites starts_on. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(rid)) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  try {
    const { user, error: authError } = await getServerAuth(request);
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const limited = await enforceRateLimit(request, 'sport-event', { userId: user.id });
    if (limited) return limited;
    const body = await readJson(request);
    const actor = await resolveActor(user.id, bodyProfileId(body));
    if (!actor.ok) return actor.response;
    const parsed = parseRoundInput(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error.replace(/^round\./, '') }, { status: 400 });

    const admin = getSupabaseAdmin();
    const read = await readSportEventAccess(admin, id, actor.profileId, null);
    if (!read) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (!read.access.canManage) return NextResponse.json({ error: 'Only an organizer can edit the round.' }, { status: 403 });
    if (read.event.status !== 'draft' && read.event.status !== 'open') return NextResponse.json({ error: 'The round can no longer be edited.' }, { status: 409 });
    const { data: round } = await admin.from('sport_event_rounds').select('id, status').eq('id', rid).eq('sport_event_id', id).maybeSingle();
    if (!round) return NextResponse.json({ error: 'Round not found' }, { status: 404 });

    const snapshot = await snapshotRound(admin, parsed.value);
    if (!snapshot) return NextResponse.json({ error: 'Course not found' }, { status: 400 });
    const { error } = await admin.from('sport_event_rounds').update(snapshot).eq('id', rid);
    if (error) {
      console.error('[api/sport-events/rounds] update failed:', error);
      return NextResponse.json({ error: 'Could not update the round' }, { status: 500 });
    }
    await writeStartsOn(admin, id);
    const view = await fetchSportEventView(admin, id, actor.profileId, null);
    return NextResponse.json(view, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[api/sport-events/rounds] PUT error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
