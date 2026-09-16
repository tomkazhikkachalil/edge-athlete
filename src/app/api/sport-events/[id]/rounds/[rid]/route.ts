import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
import { bodyProfileId, readJson, resolveActor } from '@/lib/sport-events/actor-server';
import { dateOrderRefusal, deleteRefusal, renumberAfterDelete, ROUND_DATE_REFUSAL_COPY, ROUND_DELETE_REFUSAL_COPY } from '@/lib/sport-events/rounds';
import { deleteRound, ROUND_COLUMNS, snapshotRound, writeStartsOn } from '@/lib/sport-events/rounds-server';
import type { SportEventRoundRow } from '@/lib/sport-events/types';
import { parseRoundInput } from '@/lib/sport-events/validate';
import { fetchSportEventView } from '@/lib/sport-events/view-server';
import type { SportEventSport } from '@/lib/sport-events/types';

const NOT_FOUND = () => NextResponse.json({ error: 'Event not found' }, { status: 404 });

/**
 * PUT — replace a round's plan (date, course, tee, holes, start) while THE
 * ROUND is still scheduled (phase 2: round 3 is editable while round 1 is
 * live); re-snapshots the catalog, keeps the date order against its
 * neighbours, rewrites starts_on.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(rid)) return NOT_FOUND();
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
    if (!read) return NOT_FOUND();
    // Phase 4: a team sport's round is a place + a start; the golf fields are refused by name.
    const parsed = parseRoundInput(body, 'round', { sport: (read.event.sport_key as SportEventSport) });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error.replace(/^round\./, '') }, { status: 400 });
    if (!read.access.canManage) return NextResponse.json({ error: 'Only an organizer can edit the round.' }, { status: 403 });
    const { data: rows } = await admin.from('sport_event_rounds').select(ROUND_COLUMNS).eq('sport_event_id', id);
    const rounds = (rows ?? []) as SportEventRoundRow[];
    const round = rounds.find(r => r.id === rid);
    if (!round) return NextResponse.json({ error: 'Round not found' }, { status: 404 });
    if (round.status !== 'scheduled' || !['draft', 'open', 'live'].includes(read.event.status)) return NextResponse.json({ error: 'The round can no longer be edited.' }, { status: 409 });
    const order = dateOrderRefusal(rounds, { sequence: round.sequence, scheduled_on: parsed.value.scheduled_on });
    if (order) return NextResponse.json({ error: ROUND_DATE_REFUSAL_COPY[order], reason: 'round_out_of_order' }, { status: 400 });

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

/**
 * DELETE — remove a scheduled round (phase 2). Refused by name for a round
 * that has started and for the event's last non-cancelled round (cancel the
 * event instead). The announce post goes first, the later rounds move up.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(rid)) return NOT_FOUND();
  try {
    const { user, error: authError } = await getServerAuth(request);
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const limited = await enforceRateLimit(request, 'sport-event', { userId: user.id });
    if (limited) return limited;
    const url = new URL(request.url);
    const actor = await resolveActor(user.id, url.searchParams.get('as'));
    if (!actor.ok) return actor.response;

    const admin = getSupabaseAdmin();
    const read = await readSportEventAccess(admin, id, actor.profileId, null);
    if (!read) return NOT_FOUND();
    if (!read.access.canManage) return NextResponse.json({ error: 'Only an organizer can remove a round.' }, { status: 403 });
    const { data: rows } = await admin.from('sport_event_rounds').select(ROUND_COLUMNS).eq('sport_event_id', id);
    const rounds = (rows ?? []) as SportEventRoundRow[];
    const round = rounds.find(r => r.id === rid);
    if (!round) return NextResponse.json({ error: 'Round not found' }, { status: 404 });
    if (!['draft', 'open', 'live'].includes(read.event.status)) return NextResponse.json({ error: 'Rounds can no longer be removed.' }, { status: 409 });
    const refusal = deleteRefusal(round, rounds);
    if (refusal) return NextResponse.json({ error: ROUND_DELETE_REFUSAL_COPY[refusal], reason: refusal }, { status: 409 });

    const ok = await deleteRound(admin, id, round, renumberAfterDelete(rounds, round.sequence));
    if (!ok) return NextResponse.json({ error: 'Could not remove the round' }, { status: 500 });
    const view = await fetchSportEventView(admin, id, actor.profileId, null);
    return NextResponse.json(view, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[api/sport-events/rounds] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
