import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
import { resolveActor } from '@/lib/sport-events/actor-server';
import { mediaRight } from '@/lib/sport-events/media';
import { readEventMedia } from '@/lib/sport-events/media-server';

const NOT_FOUND = () => NextResponse.json({ error: 'Event not found' }, { status: 404 });

/** DELETE — remove one photo / video: the uploader, or an organizer (`mediaRight`). A mirrored copy on the round's post stays (the post's own media). */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; mid: string }> }) {
  const { id, mid } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(mid)) return NOT_FOUND();
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
    const { data: row } = await admin.from('sport_event_media').select('id, uploaded_by').eq('id', mid).eq('sport_event_id', id).maybeSingle();
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const right = mediaRight('remove', { viewerId: actor.profileId, eventStatus: read.event.status, eventRole: read.access.role, participantStatus: read.access.participantStatus, canManage: read.access.canManage, uploadedBy: row.uploaded_by as string });
    if (!right.allowed) return NextResponse.json({ error: right.error }, { status: right.status });
    const { error } = await admin.from('sport_event_media').delete().eq('id', mid);
    if (error) {
      console.error('[api/sport-events/media] delete failed:', error);
      return NextResponse.json({ error: 'Could not remove it' }, { status: 500 });
    }
    const media = await readEventMedia(admin, read.event, { profileId: actor.profileId, canManage: read.access.canManage });
    return NextResponse.json({ media }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[api/sport-events/media] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
