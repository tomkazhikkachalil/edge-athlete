import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { filterBlockedBidirectional } from '@/lib/blocks';
import { checkSupervisedInviteGate } from '@/lib/calendar/supervised-invites';
import { PARTICIPANT_COLUMNS, readSportEventAccess } from '@/lib/sport-events/access-server';
import { bodyProfileId, readJson, resolveActor } from '@/lib/sport-events/actor-server';
import { planJoin } from '@/lib/sport-events/join';
import { readRoster, toSnapshot } from '@/lib/sport-events/join-server';
import { notifyInvites } from '@/lib/sport-events/notify';
import type { SportEventParticipantRow } from '@/lib/sport-events/types';
import { parseInviteBody } from '@/lib/sport-events/validate';
import { reportRouteError } from '@/lib/observability/report';
import { recordCoOrganizerInvited } from '@/lib/sport-events/roles-server';

/**
 * POST — invite players by profile id and / or handle (organizers, draft /
 * open). Blocked profiles (either direction) are skipped silently; a
 * supervised athlete is invited only past the family's invite dial (the
 * calendar's gate); an existing invited / accepted / requested row is
 * skipped as existing; a follower becomes an invited player. Answers who
 * was invited and how many were skipped, by reason.
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
    const parsed = parseInviteBody(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const admin = getSupabaseAdmin();
    const read = await readSportEventAccess(admin, id, actor.profileId, null);
    if (!read) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (!read.access.canManage) return NextResponse.json({ error: 'Only an organizer can invite.' }, { status: 403 });
    // Authority PR 2: a co-organizer who does not play takes no seat, so the host may add one while live.
    const inviteAs = { role: parsed.value.role, playing: parsed.value.playing };
    const seatlessBackup = inviteAs.role === 'co_organizer' && !inviteAs.playing;
    // Only the host names a co-organizer — refused up front, not skipped per person.
    if (inviteAs.role === 'co_organizer' && read.event.host_profile_id !== actor.profileId) return NextResponse.json({ error: 'Only the host can add a co-organizer.' }, { status: 403 });
    if (read.event.status !== 'draft' && read.event.status !== 'open' && !(seatlessBackup && read.event.status === 'live')) return NextResponse.json({ error: 'The event is not taking invites.' }, { status: 409 });

    const skipped = { unknown: 0, blocked: 0, supervised: 0, existing: 0 };
    const candidates = new Set<string>(parsed.value.profileIds);
    if (parsed.value.handles.length > 0) {
      const { data: byHandle } = await admin.from('profiles').select('id, handle').in('handle', parsed.value.handles);
      const found = new Set(((byHandle ?? []) as Array<{ handle: string }>).map(p => p.handle));
      skipped.unknown += parsed.value.handles.filter(h => !found.has(h)).length;
      for (const p of (byHandle ?? []) as Array<{ id: string }>) candidates.add(p.id);
    }
    if (parsed.value.profileIds.length > 0) {
      const { data: existing } = await admin.from('profiles').select('id').in('id', parsed.value.profileIds);
      const found = new Set(((existing ?? []) as Array<{ id: string }>).map(p => p.id));
      for (const pid of parsed.value.profileIds) if (!found.has(pid)) { candidates.delete(pid); skipped.unknown += 1; }
    }
    candidates.delete(actor.profileId);

    const blocks = await filterBlockedBidirectional(admin, actor.profileId, [...candidates]);
    skipped.blocked += blocks.skipped;

    const allowed: string[] = [];
    for (const pid of blocks.allowed) {
      const gate = await checkSupervisedInviteGate(admin, actor.profileId, [pid], 0);
      if (gate.ok) allowed.push(pid);
      else skipped.supervised += 1;
    }

    const rows = await readRoster(admin, id);
    const snapshots = rows.map(toSnapshot);
    const invited: string[] = [];
    const now = new Date().toISOString();
    for (const pid of allowed) {
      const row = rows.find(r => r.profile_id === pid) ?? null;
      const plan = planJoin('invite', { event: { status: read.event.status, joinMode: read.event.join_mode, capacity: read.event.capacity }, actorRole: read.access.role, row: row ? toSnapshot(row) : null, rows: snapshots, inviteAs });
      if (!plan.ok) { skipped.existing += 1; continue; }
      // Phase 4: "Invite as recorder" — the row carries the flag from the invite; a recorder who does not play flips playing off later.
      const patch = { role: plan.next.role ?? 'participant', status: 'invited', playing: plan.next.playing ?? true, waitlist_position: null, invited_by: actor.profileId, ...(parsed.value.recorder ? { recorder: true } : {}) };
      const result = plan.create
        ? await admin.from('sport_event_participants').insert({ sport_event_id: id, profile_id: pid, ...patch }).select(PARTICIPANT_COLUMNS).single()
        : await admin.from('sport_event_participants').update({ ...patch, responded_at: null, accepted_at: null, updated_at: now }).eq('id', (row as SportEventParticipantRow).id).select(PARTICIPANT_COLUMNS).single();
      if (result.error) {
        reportRouteError('[api/sport-events/participants] invite write failed:', result.error);
        continue;
      }
      invited.push(pid);
      if (patch.role === 'co_organizer') await recordCoOrganizerInvited(admin, id, actor.profileId, pid, patch.playing);
    }

    await notifyInvites({ admin, eventId: id, eventName: read.event.name, actorProfileId: actor.profileId }, invited);
    return NextResponse.json({ invited, skipped }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    reportRouteError('[api/sport-events/participants] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
