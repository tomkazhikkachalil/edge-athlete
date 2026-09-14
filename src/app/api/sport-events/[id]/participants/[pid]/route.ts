import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { PARTICIPANT_COLUMNS, readSportEventAccess } from '@/lib/sport-events/access-server';
import { bodyProfileId, readJson, resolveActor } from '@/lib/sport-events/actor-server';
import { applyOverride } from '@/lib/sport-events/handicap';
import { snapshotAtAccept } from '@/lib/sport-events/handicap-server';
import { isFull } from '@/lib/sport-events/join';
import { applyCapacityChange, applyJoin, ORGANIZER_ACTIONS, readRoster, toSnapshot, type JoinOutcome } from '@/lib/sport-events/join-server';
import type { JoinAction } from '@/lib/sport-events/join';
import type { SportEventParticipantRow } from '@/lib/sport-events/types';
import { parseParticipantPatch } from '@/lib/sport-events/validate';

const NOT_FOUND = () => NextResponse.json({ error: 'Event not found' }, { status: 404 });
const ROW_ACTIONS: ReadonlySet<string> = new Set(['accept', 'decline', 'withdraw', 'approve', 'reject', 'remove']);

/**
 * POST {action} — accept | decline | withdraw on YOUR OWN row (or a
 * supervised athlete's, acting-as through `profile_id`); approve | reject
 * | remove on a target row (organizers). The seat / waitlist / promotion
 * rules live in planJoin; an accept freezes the index.
 *
 * PATCH — `handicap_index` (organizers; null clears the override and
 * recomputes), `hide_from_profile` (the player), `playing` (the player or
 * an organizer; stepping out frees a seat and promotes the waitlist).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; pid: string }> }) {
  const { id, pid } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(pid)) return NOT_FOUND();
  try {
    const { user, error: authError } = await getServerAuth(request);
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const limited = await enforceRateLimit(request, 'sport-event-join', { userId: user.id });
    if (limited) return limited;
    const body = await readJson(request);
    const action = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).action : null;
    if (typeof action !== 'string' || !ROW_ACTIONS.has(action)) return NextResponse.json({ error: 'action must be one of accept, decline, withdraw, approve, reject, remove' }, { status: 400 });
    const actor = await resolveActor(user.id, bodyProfileId(body));
    if (!actor.ok) return actor.response;

    const admin = getSupabaseAdmin();
    const read = await readSportEventAccess(admin, id, actor.profileId, null);
    if (!read) return NOT_FOUND();
    const { data: target } = await admin.from('sport_event_participants').select(PARTICIPANT_COLUMNS).eq('id', pid).eq('sport_event_id', id).maybeSingle();
    if (!target) return NextResponse.json({ error: 'Participant not found' }, { status: 404 });
    const row = target as SportEventParticipantRow;

    let outcome: JoinOutcome;
    if (ORGANIZER_ACTIONS.has(action as JoinAction)) {
      outcome = await applyJoin(admin, { event: read.event, access: read.access, action: action as JoinAction, actorProfileId: actor.profileId, targetParticipantId: pid });
    } else {
      if (row.profile_id !== actor.profileId) return NextResponse.json({ error: 'You can only answer for yourself.' }, { status: 403 });
      outcome = await applyJoin(admin, { event: read.event, access: read.access, action: action as JoinAction, actorProfileId: actor.profileId });
    }
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ participant: outcome.participant, promoted: outcome.promoted }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[api/sport-events/participants/[pid]] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; pid: string }> }) {
  const { id, pid } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(pid)) return NOT_FOUND();
  try {
    const { user, error: authError } = await getServerAuth(request);
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const limited = await enforceRateLimit(request, 'sport-event', { userId: user.id });
    if (limited) return limited;
    const body = await readJson(request);
    const actor = await resolveActor(user.id, bodyProfileId(body));
    if (!actor.ok) return actor.response;
    const patchBody = typeof body === 'object' && body !== null ? { ...(body as Record<string, unknown>) } : body;
    if (patchBody && typeof patchBody === 'object') delete (patchBody as Record<string, unknown>).profile_id;
    const parsed = parseParticipantPatch(patchBody);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const admin = getSupabaseAdmin();
    const read = await readSportEventAccess(admin, id, actor.profileId, null);
    if (!read) return NOT_FOUND();
    const { data: target } = await admin.from('sport_event_participants').select(PARTICIPANT_COLUMNS).eq('id', pid).eq('sport_event_id', id).maybeSingle();
    if (!target) return NextResponse.json({ error: 'Participant not found' }, { status: 404 });
    const row = target as SportEventParticipantRow;
    const isSelf = row.profile_id === actor.profileId;
    const canManage = read.access.canManage;
    if (read.event.status === 'completed' || read.event.status === 'cancelled') return NextResponse.json({ error: 'This event is over.' }, { status: 409 });

    const update: Record<string, unknown> = {};
    if (parsed.value.handicap_index !== undefined) {
      if (!canManage) return NextResponse.json({ error: 'Only an organizer can set a handicap.' }, { status: 403 });
      if (parsed.value.handicap_index === null) {
        // Clearing an override: recompute from the player's rounds.
        const fresh = await snapshotAtAccept(admin, { ...row, handicap_index: null, handicap_source: 'none' });
        Object.assign(update, fresh);
      } else {
        Object.assign(update, applyOverride(parsed.value.handicap_index));
      }
    }
    if (parsed.value.hide_from_profile !== undefined) {
      if (!isSelf) return NextResponse.json({ error: 'Only the player decides what shows on their profile.' }, { status: 403 });
      update.hide_from_profile = parsed.value.hide_from_profile;
    }
    let seatFreed = false;
    if (parsed.value.playing !== undefined && parsed.value.playing !== row.playing) {
      if (!isSelf && !canManage) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
      if (row.role === 'follower') return NextResponse.json({ error: 'A follower does not play — accept an invitation instead.' }, { status: 409 });
      if (parsed.value.playing && row.status === 'accepted') {
        const rows = (await readRoster(admin, id)).filter(r => r.id !== row.id).map(toSnapshot);
        if (isFull(rows, read.event.capacity)) return NextResponse.json({ error: 'The event is full.' }, { status: 409 });
      }
      update.playing = parsed.value.playing;
      seatFreed = !parsed.value.playing && row.status === 'accepted';
    }
    if (Object.keys(update).length === 0) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });

    const { data: updated, error } = await admin.from('sport_event_participants').update(update).eq('id', pid).select(PARTICIPANT_COLUMNS).single();
    if (error || !updated) {
      console.error('[api/sport-events/participants/[pid]] update failed:', error);
      return NextResponse.json({ error: 'Could not update the participant' }, { status: 500 });
    }
    const promoted = seatFreed ? await applyCapacityChange(admin, read.event, read.event.capacity, actor.profileId) : [];
    return NextResponse.json({ participant: updated, promoted }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[api/sport-events/participants/[pid]] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
