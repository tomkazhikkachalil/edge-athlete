import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { EVENT_COLUMNS, readSportEventAccess } from '@/lib/sport-events/access-server';
import { bodyProfileId, readJson, resolveActor } from '@/lib/sport-events/actor-server';
import { applyCapacityChange } from '@/lib/sport-events/join-server';
import { cutEditable } from '@/lib/sport-events/cut';
import { parseFormatConfig, readFormatConfig, readMatchConfig, formatConfigStale } from '@/lib/sport-events/format-config';
import { mintLinkToken } from '@/lib/sport-events/link-token';
import { activeRounds } from '@/lib/sport-events/rounds';
import { ROUND_COLUMNS } from '@/lib/sport-events/rounds-server';
import { type SportEventRoundRow, type SportEventRow, shapeOf } from '@/lib/sport-events/types';
import { parseEventPatch } from '@/lib/sport-events/validate';
import { fetchSportEventView } from '@/lib/sport-events/view-server';
import { eventShape } from '@/lib/sport-events/contest-link';
import { readCountsTowardAll } from '@/lib/sport-events/contest-link-server';
import { reportRouteError } from '@/lib/observability/report';
import { recordAuthority } from '@/lib/authority/audit-server';
import { orgRefFromBody, orgRefOf } from '@/lib/orgs/org-ref';

const NOT_FOUND = () => NextResponse.json({ error: 'Event not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });

/**
 * /api/sport-events/[id] (Events program, PR 4).
 *
 * GET ?token= — the event view. Optional auth: a public event answers
 * signed-out, a link event answers with its token, a private one answers
 * its participants (followers included) — resolveSportEventAccess is the
 * one gate and a refusal is the same 404 as not-found. `?as=` lets a
 * guardian read as a supervised athlete.
 *
 * PATCH — the editable fields while draft / open (name, description,
 * visibility, join mode, format, capacity, the org) and, while live too,
 * `format_config` (phase 2: the cut — validated against the round count,
 * refused `cut_already_passed` once the round it follows completed; phase
 * 3: the match shape — `sides` / `bracket` while draft / open only, the
 * `allowance` while live too, `match_locked` otherwise). A format change
 * across families (stroke ↔ match) must carry a `format_config` that
 * fits the new format when the stored one holds the other family's key
 * (`format_config_stale`) — never a silent strip.
 * Organizers only. A capacity raise promotes the waitlist; switching to
 * `link` mints a token.
 *
 * DELETE — the host only, and only draft / cancelled / completed. A minted
 * round detaches (203's SET NULL) and stays the players' round.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NOT_FOUND();
  const limited = await enforceRateLimit(request, 'sport-event-view');
  if (limited) return limited;
  try {
    const { user } = await getServerAuth(request);
    const url = new URL(request.url);
    let viewerId: string | null = user?.id ?? null;
    if (user && url.searchParams.get('as')) {
      const actor = await resolveActor(user.id, url.searchParams.get('as'));
      if (!actor.ok) return actor.response;
      viewerId = actor.profileId;
    }
    const view = await fetchSportEventView(getSupabaseAdmin(), id, viewerId, url.searchParams.get('token'));
    if (!view) return NOT_FOUND();
    return NextResponse.json(view, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    reportRouteError('[api/sport-events/[id]] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NOT_FOUND();
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
    if (!read.access.canManage) return NextResponse.json({ error: 'Only an organizer can edit this event.' }, { status: 403 });

    const patchBody = typeof body === 'object' && body !== null ? { ...(body as Record<string, unknown>) } : body;
    if (patchBody && typeof patchBody === 'object') delete (patchBody as Record<string, unknown>).profile_id;
    const parsed = parseEventPatch(patchBody);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const patch = parsed.value;
    // Phase 2: the format options (the cut) may change while live, until the round the cut follows has completed; everything else is draft / open only.
    const onlyFormatConfig = Object.keys(patch).every(k => k === 'format_config');
    if (read.event.status !== 'draft' && read.event.status !== 'open' && !(onlyFormatConfig && read.event.status === 'live')) return NextResponse.json({ error: 'This event can no longer be edited.' }, { status: 409 });
    const nextFormat = patch.format ?? read.event.format;
    const stored = readFormatConfig(read.event.format_config, 8, read.event.format, shapeOf(read.event));
    if (patch.format !== undefined && shapeOf(read.event) !== 'round') return NextResponse.json({ error: 'format is golf vocabulary — a team event has none' }, { status: 400 });
    let formatConfig: Record<string, unknown> | null = null;
    if (patch.format_config !== undefined) {
      const { data: roundRows } = await admin.from('sport_event_rounds').select(ROUND_COLUMNS).eq('sport_event_id', id);
      const rounds = activeRounds((roundRows ?? []) as SportEventRoundRow[]);
      const fc = parseFormatConfig(patch.format_config, { roundCount: rounds.length, format: nextFormat, shape: shapeOf(read.event), allowSideTeams: false });
      if (!fc.ok) return NextResponse.json({ error: fc.error }, { status: 400 });
      if (fc.value.cut && !cutEditable(fc.value.cut, rounds)) return NextResponse.json({ error: 'That cut falls after a round that has already completed.', reason: 'cut_already_passed' }, { status: 409 });
      // Phase 3: the match SHAPE is fixed once the event is live (the draw depends on it); the allowance may still change.
      if (read.event.status === 'live') {
        const before = readMatchConfig(stored, read.event.format);
        const after = readMatchConfig(fc.value, nextFormat);
        if (before && after && (before.sides !== after.sides || before.bracket !== after.bracket)) return NextResponse.json({ error: 'The sides and the bracket are set before the event starts.', reason: 'match_locked' }, { status: 409 });
      }
      formatConfig = fc.value as Record<string, unknown>;
    } else if (formatConfigStale(read.event.format, nextFormat, stored)) {
      return NextResponse.json({ error: 'Changing the format needs format_config for the new format.', reason: 'format_config_stale' }, { status: 400 });
    }
    // Leftovers: an event that counts toward a competition keeps its SHAPE (stroke → match / Stableford would orphan the link).
    if (patch.format !== undefined && eventShape({ sport_key: read.event.sport_key, format: nextFormat, shape: read.event.shape }) !== eventShape(read.event)) {
      const { data: roundIdRows } = await admin.from('sport_event_rounds').select('id').eq('sport_event_id', read.event.id);
      const links = await readCountsTowardAll(admin, ((roundIdRows ?? []) as Array<{ id: string }>).map(r => r.id));
      if (links && links.size > 0) return NextResponse.json({ error: 'Remove the competition link before changing the format.', reason: 'linked_competition' }, { status: 409 });
    }

    // The body speaks the public club_id / league_id; the row is org_id + kind
    // (Round 5 D0-b). Omission keeps the current org; an explicit null DETACHES
    // (234's trigger follows org_id).
    const curRef = orgRefOf(read.event);
    const nextPublic = {
      league_id: patch.league_id !== undefined ? patch.league_id : (curRef?.side === 'league' ? curRef.orgId : null),
      club_id: patch.club_id !== undefined ? patch.club_id : (curRef?.side === 'club' ? curRef.orgId : null),
    };
    const next = orgRefFromBody(nextPublic);
    if (!next.ok) return NextResponse.json({ error: 'An event belongs to a club or a league, not both' }, { status: 400 });
    const nextRef = next.ref;
    const orgChanged = (nextRef?.orgId ?? null) !== (curRef?.orgId ?? null);
    if (orgChanged && nextRef) {
      if (actor.actingAs) return NextResponse.json({ error: 'An organization event is hosted from your own account.' }, { status: 403 });
      const gate = await requireOrgManager(admin, user, nextRef.side, nextRef.orgId, { intent: 'manage_competitions' });
      if (!gate.ok) return gate.response;
    }

    const { club_id: _publicClub, league_id: _publicLeague, ...patchColumns } = patch; // eslint-disable-line @typescript-eslint/no-unused-vars -- the public fields became org_id
    const update: Record<string, unknown> = { ...patchColumns };
    if (patch.club_id !== undefined || patch.league_id !== undefined) update.org_id = nextRef?.orgId ?? null;
    if (formatConfig !== null) update.format_config = formatConfig;
    if (patch.visibility === 'link' && !read.event.link_token) update.link_token = mintLinkToken();

    const { data: updated, error: updateError } = await admin.from('sport_events').update(update).eq('id', id).select(EVENT_COLUMNS).single();
    if (updateError || !updated) {
      reportRouteError('[api/sport-events/[id]] update failed:', updateError);
      return NextResponse.json({ error: 'Could not update the event' }, { status: 500 });
    }
    const row = updated as SportEventRow;
    await recordAuthority(admin, {
      subject: { type: 'sport_event', id },
      actor: { kind: 'member', profileId: actor.profileId },
      action: 'event_details_changed',
      detail: { fields: Object.keys(update).filter(k => k !== 'link_token') },
    });
    const capacityRaised = patch.capacity !== undefined && (patch.capacity === null || (read.event.capacity !== null && patch.capacity > read.event.capacity));
    let promoted: string[] = [];
    if (capacityRaised) promoted = await applyCapacityChange(admin, row, row.capacity, actor.profileId);

    const view = await fetchSportEventView(admin, id, actor.profileId, null);
    return NextResponse.json({ ...view, promoted }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    reportRouteError('[api/sport-events/[id]] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NOT_FOUND();
  try {
    const { user, error: authError } = await getServerAuth(request);
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const url = new URL(request.url);
    const actor = await resolveActor(user.id, url.searchParams.get('as'));
    if (!actor.ok) return actor.response;
    const admin = getSupabaseAdmin();
    const read = await readSportEventAccess(admin, id, actor.profileId, null);
    if (!read) return NOT_FOUND();
    if (!read.access.canDelete) return NextResponse.json({ error: 'Only the host can delete this event.' }, { status: 403 });
    if (!['draft', 'cancelled', 'completed'].includes(read.event.status)) return NextResponse.json({ error: 'Cancel the event before deleting it.' }, { status: 409 });
    const { error: deleteError } = await admin.from('sport_events').delete().eq('id', id);
    if (deleteError) {
      reportRouteError('[api/sport-events/[id]] delete failed:', deleteError);
      return NextResponse.json({ error: 'Could not delete the event' }, { status: 500 });
    }
    await recordAuthority(admin, {
      subject: { type: 'sport_event', id },
      actor: { kind: 'member', profileId: actor.profileId },
      action: 'event_deleted',
      detail: { title: (read.event as { name?: string }).name ?? null, status: read.event.status },
    });
    return NextResponse.json({ deleted: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    reportRouteError('[api/sport-events/[id]] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
