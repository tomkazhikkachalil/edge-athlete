import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireActiveWriter, requireAuth } from '@/lib/auth-server';
import { resolveActingProfile } from '@/lib/guardian-gate';
import { isUuid } from '@/lib/uuid';
import { reportRouteError } from '@/lib/observability/report';
import { parseActivityMediaPatch } from '@/lib/activities/media';
import { ACTIVITY_MEDIA_COLUMNS } from '@/lib/activities/media-server';
import { readActivityForViewer } from '@/lib/activities/read-server';

/**
 * /api/activities/[id]/media/[mediaId] — one photo (Live Activities, 251).
 * PATCH { caption?, at_s?, media_url?, thumbnail_url?, targetProfileId? }:
 * the caption, the moment, or a re-rendered file (the pencil; the old file
 * becomes unreferenced and the sweep reclaims it). DELETE removes the row
 * (the file follows through the sweep). The OWNER only, both.
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' };
const notFound = () => NextResponse.json({ error: 'Photo not found' }, { status: 404, headers: NO_STORE });
type Ctx = { params: Promise<{ id: string; mediaId: string }> };

async function ownerOf(request: NextRequest, id: string, body: unknown, userId: string) {
  const target = (body as { targetProfileId?: unknown } | null)?.targetProfileId;
  const gate = await resolveActingProfile(userId, typeof target === 'string' && target ? target : null, 'Only a guardian may edit photos for this profile.');
  if (!gate.ok) return { ok: false as const, response: NextResponse.json({ error: gate.error }, { status: gate.status }) };
  const admin = getSupabaseAdmin();
  const read = await readActivityForViewer(admin, gate.actorId, id);
  if (!read.ok || read.audience !== 'owner' || read.row.profile_id !== gate.actorId) return { ok: false as const, response: notFound() };
  return { ok: true as const, admin, actorId: gate.actorId };
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { id, mediaId } = await params;
    if (!isUuid(id) || !isUuid(mediaId)) return notFound();
    const user = await requireActiveWriter(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const owner = await ownerOf(request, id, body, user.id);
    if (!owner.ok) return owner.response;
    const parsed = parseActivityMediaPatch(body, owner.actorId);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { data, error } = await owner.admin
      .from('activity_media')
      .update(parsed.value)
      .eq('id', mediaId)
      .eq('activity_id', id)
      .select(ACTIVITY_MEDIA_COLUMNS)
      .maybeSingle();
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'That photo is already on this activity.' }, { status: 409, headers: NO_STORE });
      console.error('[activities media] update failed:', error.message);
      return NextResponse.json({ error: 'Could not save the photo.' }, { status: 500 });
    }
    if (!data) return notFound();
    return NextResponse.json({ media: data }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[activities/[id]/media/[mediaId]] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { id, mediaId } = await params;
    if (!isUuid(id) || !isUuid(mediaId)) return notFound();
    const user = await requireAuth(request);
    const target = new URL(request.url).searchParams.get('targetProfileId');
    const owner = await ownerOf(request, id, target ? { targetProfileId: target } : null, user.id);
    if (!owner.ok) return owner.response;
    const { data, error } = await owner.admin.from('activity_media').delete().eq('id', mediaId).eq('activity_id', id).select('id');
    if (error) {
      console.error('[activities media] delete failed:', error.message);
      return NextResponse.json({ error: 'Could not remove the photo.' }, { status: 500 });
    }
    if (!data || data.length === 0) return notFound();
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[activities/[id]/media/[mediaId]] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
