import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireActiveWriter } from '@/lib/auth-server';
import { resolveActingProfile } from '@/lib/guardian-gate';
import { enforceRateLimit } from '@/lib/rate-limit';
import { isUuid } from '@/lib/uuid';
import { reportRouteError } from '@/lib/observability/report';
import { ACTIVITY_MEDIA_MAX, parseActivityMediaBody } from '@/lib/activities/media';
import { ACTIVITY_MEDIA_COLUMNS, readActivityMedia } from '@/lib/activities/media-server';
import { readActivityForViewer, readStream } from '@/lib/activities/read-server';
import { projectActivityMedia, projectStream } from '@/lib/activities/visibility';

/**
 * /api/activities/[id]/media — the activity's photos (Live Activities, 251).
 *
 * GET: everyone the activity's gate admits (the same 404 as not-found
 * otherwise); pins resolved from THIS viewer's stream. `private, no-store`.
 *
 * POST { media_url, media_type, thumbnail_url?, duration_seconds?, caption?,
 * at_s?, targetProfileId? } — after `uploadPostMedia`: the OWNER only (the
 * athlete, or a guardian acting through the shared gate); the URL must be a
 * file THIS profile uploaded (posts/<profile>/…); at most 20 per activity;
 * the same URL twice is the same row (201 the first time, 200 after — a
 * retried attach never duplicates). Behind the write gate: a photo is
 * content.
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' };
const notFound = () => NextResponse.json({ error: 'Activity not found' }, { status: 404, headers: NO_STORE });
type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return notFound();
    const { getServerAuth } = await import('@/lib/auth-server');
    const { user } = await getServerAuth(request);
    const admin = getSupabaseAdmin();
    const read = await readActivityForViewer(admin, user?.id ?? null, id);
    if (!read.ok) return notFound();
    const [rows, stream] = await Promise.all([readActivityMedia(admin, id), readStream(admin, read.row.stream_path)]);
    return NextResponse.json({ media: projectActivityMedia(rows, projectStream(stream, read.audience)) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[activities/[id]/media] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return notFound();
    const user = await requireActiveWriter(request);
    const limited = await enforceRateLimit(request, 'activity-media', { userId: user.id });
    if (limited) return limited;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const target = (body as { targetProfileId?: unknown } | null)?.targetProfileId;
    const gate = await resolveActingProfile(user.id, typeof target === 'string' && target ? target : null, 'Only a guardian may add photos for this profile.');
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
    const admin = getSupabaseAdmin();
    const read = await readActivityForViewer(admin, gate.actorId, id);
    if (!read.ok || read.audience !== 'owner' || read.row.profile_id !== gate.actorId) return notFound();
    const parsed = parseActivityMediaBody(body, gate.actorId);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { data: existing } = await admin.from('activity_media').select('id, display_order').eq('activity_id', id);
    const rows = (existing ?? []) as Array<{ id: string; display_order: number }>;
    const { data: same } = await admin.from('activity_media').select(ACTIVITY_MEDIA_COLUMNS).eq('activity_id', id).eq('media_url', parsed.value.media_url).maybeSingle();
    if (same) return NextResponse.json({ media: same, created: false }, { status: 200, headers: NO_STORE });
    if (rows.length >= ACTIVITY_MEDIA_MAX) {
      return NextResponse.json({ error: `An activity holds at most ${ACTIVITY_MEDIA_MAX} photos.` }, { status: 409, headers: NO_STORE });
    }
    const displayOrder = rows.reduce((max, r) => Math.max(max, r.display_order), 0) + 1;
    const { data: inserted, error } = await admin
      .from('activity_media')
      .insert({
        activity_id: id,
        profile_id: gate.actorId,
        created_by_user_id: gate.actorId !== user.id ? user.id : null,
        ...parsed.value,
        display_order: displayOrder,
      })
      .select(ACTIVITY_MEDIA_COLUMNS)
      .single();
    if (error || !inserted) {
      if (error?.code === '23505') {
        const { data: winner } = await admin.from('activity_media').select(ACTIVITY_MEDIA_COLUMNS).eq('activity_id', id).eq('media_url', parsed.value.media_url).maybeSingle();
        if (winner) return NextResponse.json({ media: winner, created: false }, { status: 200, headers: NO_STORE });
      }
      console.error('[activities media] insert failed:', error?.message);
      return NextResponse.json({ error: 'Could not add the photo.' }, { status: 500 });
    }
    return NextResponse.json({ media: inserted, created: true }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[activities/[id]/media] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
