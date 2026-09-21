import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
import { bodyProfileId, readJson, resolveActor } from '@/lib/sport-events/actor-server';
import { mintAnnouncePost } from '@/lib/sport-events/lifecycle-server';
import { dateOrderRefusal, MAX_ROUNDS, nextSequence, ROUND_DATE_REFUSAL_COPY } from '@/lib/sport-events/rounds';
import { insertRound, ROUND_COLUMNS, snapshotRound } from '@/lib/sport-events/rounds-server';
import type { SportEventRoundRow } from '@/lib/sport-events/types';
import { parseRoundInput } from '@/lib/sport-events/validate';
import { fetchSportEventView } from '@/lib/sport-events/view-server';
import type { SportEventSport } from '@/lib/sport-events/types';
import { reportRouteError } from '@/lib/observability/report';

/**
 * POST — add a round (Events program, phase 2). Organizers, while the
 * event is draft, open or live (a tournament grows until its last round
 * completes). The new round is appended (`sequence` = max + 1 — the 201
 * UNIQUE is not deferrable, so rounds never reorder) and its date may not
 * precede the previous round's. At most MAX_ROUNDS. An open or live event
 * mints the round's announce post at once (one post per round).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    // Phase 4: a team sport's round is a place + a start; the golf fields are refused by name.
    const parsed = parseRoundInput(body, 'round', { sport: (read.event.sport_key as SportEventSport) });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error.replace(/^round\./, '') }, { status: 400 });
    if (!read.access.canManage) return NextResponse.json({ error: 'Only an organizer can add a round.' }, { status: 403 });
    if (!['draft', 'open', 'live'].includes(read.event.status)) return NextResponse.json({ error: 'Rounds can no longer be added.' }, { status: 409 });
    const { data: existing } = await admin.from('sport_event_rounds').select(ROUND_COLUMNS).eq('sport_event_id', id);
    const rounds = (existing ?? []) as SportEventRoundRow[];
    if (rounds.filter(r => r.status !== 'cancelled').length >= MAX_ROUNDS) return NextResponse.json({ error: `An event has at most ${MAX_ROUNDS} rounds.`, reason: 'too_many_rounds' }, { status: 409 });
    const order = dateOrderRefusal(rounds, { sequence: null, scheduled_on: parsed.value.scheduled_on });
    if (order) return NextResponse.json({ error: ROUND_DATE_REFUSAL_COPY[order], reason: 'round_out_of_order' }, { status: 400 });

    const snapshot = await snapshotRound(admin, parsed.value);
    if (!snapshot) return NextResponse.json({ error: 'Course not found' }, { status: 400 });
    const inserted = await insertRound(admin, id, nextSequence(rounds), snapshot);
    if (!inserted) return NextResponse.json({ error: 'Could not add the round' }, { status: 500 });
    if (read.event.status !== 'draft') {
      const postId = await mintAnnouncePost(admin, read.event, { id: inserted.id, course_name: snapshot.course_name, scheduled_on: snapshot.scheduled_on });
      if (!postId) reportRouteError('[api/sport-events/rounds] announce post for the added round failed');
    }
    const view = await fetchSportEventView(admin, id, actor.profileId, null);
    return NextResponse.json(view, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    reportRouteError('[api/sport-events/rounds] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
