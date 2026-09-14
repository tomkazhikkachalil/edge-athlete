import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { EVENT_COLUMNS, readSportEventAccess } from '@/lib/sport-events/access-server';
import { bodyProfileId, readJson, resolveActor } from '@/lib/sport-events/actor-server';
import { applyCapacityChange } from '@/lib/sport-events/join-server';
import { mintLinkToken } from '@/lib/sport-events/link-token';
import type { SportEventRow } from '@/lib/sport-events/types';
import { parseEventPatch } from '@/lib/sport-events/validate';
import { fetchSportEventView } from '@/lib/sport-events/view-server';

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
 * visibility, join mode, format, capacity, the org). Organizers only. A
 * capacity raise promotes the waitlist; switching to `link` mints a token.
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
    console.error('[api/sport-events/[id]] GET error:', error);
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
    if (read.event.status !== 'draft' && read.event.status !== 'open') return NextResponse.json({ error: 'This event can no longer be edited.' }, { status: 409 });

    const patchBody = typeof body === 'object' && body !== null ? { ...(body as Record<string, unknown>) } : body;
    if (patchBody && typeof patchBody === 'object') delete (patchBody as Record<string, unknown>).profile_id;
    const parsed = parseEventPatch(patchBody);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const patch = parsed.value;

    const nextClub = patch.club_id !== undefined ? patch.club_id : read.event.club_id;
    const nextLeague = patch.league_id !== undefined ? patch.league_id : read.event.league_id;
    if (nextClub && nextLeague) return NextResponse.json({ error: 'An event belongs to a club or a league, not both' }, { status: 400 });
    const orgChanged = (patch.club_id !== undefined && patch.club_id !== read.event.club_id) || (patch.league_id !== undefined && patch.league_id !== read.event.league_id);
    if (orgChanged && (nextClub || nextLeague)) {
      if (actor.actingAs) return NextResponse.json({ error: 'An organization event is hosted from your own account.' }, { status: 403 });
      const gate = await requireOrgManager(admin, user, nextClub ? 'club' : 'league', (nextClub ?? nextLeague) as string, { intent: 'manage_competitions' });
      if (!gate.ok) return gate.response;
    }

    const update: Record<string, unknown> = { ...patch };
    if (patch.visibility === 'link' && !read.event.link_token) update.link_token = mintLinkToken();

    const { data: updated, error: updateError } = await admin.from('sport_events').update(update).eq('id', id).select(EVENT_COLUMNS).single();
    if (updateError || !updated) {
      console.error('[api/sport-events/[id]] update failed:', updateError);
      return NextResponse.json({ error: 'Could not update the event' }, { status: 500 });
    }
    const row = updated as SportEventRow;
    const capacityRaised = patch.capacity !== undefined && (patch.capacity === null || (read.event.capacity !== null && patch.capacity > read.event.capacity));
    let promoted: string[] = [];
    if (capacityRaised) promoted = await applyCapacityChange(admin, row, row.capacity, actor.profileId);

    const view = await fetchSportEventView(admin, id, actor.profileId, null);
    return NextResponse.json({ ...view, promoted }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[api/sport-events/[id]] PATCH error:', error);
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
      console.error('[api/sport-events/[id]] delete failed:', deleteError);
      return NextResponse.json({ error: 'Could not delete the event' }, { status: 500 });
    }
    return NextResponse.json({ deleted: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/sport-events/[id]] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
