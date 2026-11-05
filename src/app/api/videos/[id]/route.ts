import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { parseVideoPatch, placeOf } from '@/lib/videos/rules';
import { deleteVideo, placeRight, readVideoForViewer, updateVideo } from '@/lib/videos/videos-server';
import { reportRouteError } from '@/lib/observability/report';

const PRIVATE = { 'Cache-Control': 'private, no-store' };
const NOT_FOUND = () => NextResponse.json({ error: 'Video not found' }, { status: 404, headers: PRIVATE });

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** GET — the video, its markers in time order, and whether THIS viewer manages it. A refusal is the same 404 as not-found. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NOT_FOUND();
  try {
    const { user } = await getServerAuth(request);
    const read = await readVideoForViewer(getSupabaseAdmin(), id, user ?? null);
    if (!read) return NOT_FOUND();
    return NextResponse.json({ video: read.view, highlights: read.highlights, can_manage: read.canManage }, { headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/videos/id] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH {title?, description?, sport_key?, status?, and at most one place id} — a manager edits; a new place needs that place's manager. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NOT_FOUND();
  try {
    const { user, error: authError, limited } = await getServerAuth(request, { limit: 'video-write' });
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (limited) return limited;
    const parsed = parseVideoPatch(await readJson(request));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const admin = getSupabaseAdmin();
    const read = await readVideoForViewer(admin, id, user);
    if (!read) return NOT_FOUND();
    if (!read.canManage) return NextResponse.json({ error: 'Only a manager can edit this video.' }, { status: 403 });
    const place = placeOf(parsed.value);
    if (place) {
      const right = await placeRight(admin, place, read.row.profile_id ?? user.id, user);
      if (!right.ok) return NextResponse.json({ error: right.error }, { status: right.status });
    }
    const updated = await updateVideo(admin, id, parsed.value);
    if (!updated.ok) return NextResponse.json({ error: updated.error }, { status: updated.status });
    const after = await readVideoForViewer(admin, id, user);
    return NextResponse.json({ video: after?.view ?? null, highlights: after?.highlights ?? [], can_manage: true }, { headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/videos/id] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE — the link goes (its markers with it). A link is not a result: nothing is kept behind. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NOT_FOUND();
  try {
    const { user, error: authError, limited } = await getServerAuth(request, { limit: 'video-write' });
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (limited) return limited;
    const admin = getSupabaseAdmin();
    const read = await readVideoForViewer(admin, id, user);
    if (!read) return NOT_FOUND();
    if (!read.canManage) return NextResponse.json({ error: 'Only a manager can delete this video.' }, { status: 403 });
    const gone = await deleteVideo(admin, id, read.row.org_id);
    if (!gone.ok) return NextResponse.json({ error: gone.error }, { status: gone.status });
    return NextResponse.json({ ok: true }, { headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/videos/id] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
