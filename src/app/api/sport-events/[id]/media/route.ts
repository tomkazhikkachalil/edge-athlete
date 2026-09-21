import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
import { bodyProfileId, readJson, resolveActor } from '@/lib/sport-events/actor-server';
import { mediaRight, parseMediaBody } from '@/lib/sport-events/media';
import { MEDIA_COLUMNS, readEventMedia } from '@/lib/sport-events/media-server';
import { reportRouteError } from '@/lib/observability/report';

const NOT_FOUND = () => NextResponse.json({ error: 'Event not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });

/**
 * GET ?token=&as= — the event's gallery (Events program, phase 4, 216):
 * everyone who may view the event, signed out on a public one; newest
 * first, URLs through the media proxy. Polled while live (10 s).
 *
 * POST {media_url, media_type, thumbnail_url?, duration_seconds?, caption?,
 * round_id?} — after `uploadPostMedia`: any accepted participant (followers
 * included) or an organizer, while the event is not cancelled
 * (`mediaRight`). A supervised uploader's media publishes at once (the
 * shared-round carve-out); `created_by_user_id` names the guardian when
 * one acts.
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
    const admin = getSupabaseAdmin();
    const read = await readSportEventAccess(admin, id, viewerId, url.searchParams.get('token'));
    if (!read) return NOT_FOUND();
    const media = await readEventMedia(admin, read.event, { profileId: viewerId, canManage: read.access.canManage });
    const canAdd = mediaRight('add', { viewerId, eventStatus: read.event.status, eventRole: read.access.role, participantStatus: read.access.participantStatus, canManage: read.access.canManage }).allowed;
    return NextResponse.json({ media, can_add: canAdd }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    reportRouteError('[api/sport-events/media] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const parsed = parseMediaBody(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const admin = getSupabaseAdmin();
    const read = await readSportEventAccess(admin, id, actor.profileId, null);
    if (!read) return NOT_FOUND();
    const right = mediaRight('add', { viewerId: actor.profileId, eventStatus: read.event.status, eventRole: read.access.role, participantStatus: read.access.participantStatus, canManage: read.access.canManage });
    if (!right.allowed) return NextResponse.json({ error: right.error }, { status: right.status });
    if (parsed.value.round_id) {
      const { data: round } = await admin.from('sport_event_rounds').select('id').eq('id', parsed.value.round_id).eq('sport_event_id', id).maybeSingle();
      if (!round) return NextResponse.json({ error: 'Round not found' }, { status: 404 });
    }
    const { data: inserted, error } = await admin
      .from('sport_event_media')
      .insert({
        sport_event_id: id,
        sport_event_round_id: parsed.value.round_id,
        uploaded_by: actor.profileId,
        ...(actor.actingAs ? { created_by_user_id: user.id } : {}),
        media_url: parsed.value.media_url,
        media_type: parsed.value.media_type,
        thumbnail_url: parsed.value.thumbnail_url,
        duration_seconds: parsed.value.duration_seconds,
        caption: parsed.value.caption,
      })
      .select(MEDIA_COLUMNS)
      .single();
    if (error || !inserted) {
      reportRouteError('[api/sport-events/media] insert failed:', error);
      return NextResponse.json({ error: 'Could not add the photo' }, { status: 500 });
    }
    const media = await readEventMedia(admin, read.event, { profileId: actor.profileId, canManage: read.access.canManage });
    return NextResponse.json({ media, added: (inserted as { id: string }).id }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    reportRouteError('[api/sport-events/media] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
