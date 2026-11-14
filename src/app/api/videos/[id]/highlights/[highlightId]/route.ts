import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { parseHighlightPatch } from '@/lib/videos/rules';
import { deleteHighlight, listHighlights, prepareTag, readVideoForViewer, updateHighlight } from '@/lib/videos/videos-server';
import { reportRouteError } from '@/lib/observability/report';

const PRIVATE = { 'Cache-Control': 'private, no-store' };
const NOT_FOUND = () => NextResponse.json({ error: 'Video not found' }, { status: 404, headers: PRIVATE });

type Params = { params: Promise<{ id: string; highlightId: string }> };

/** PATCH {start_ms?, end_ms?, label?, meta?} — a manager edits a marker; the range rule holds against the stored row. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id, highlightId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(highlightId)) return NOT_FOUND();
  try {
    const { user, error: authError, limited } = await getServerAuth(request, { limit: 'video-write' });
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (limited) return limited;
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const parsed = parseHighlightPatch(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const admin = getSupabaseAdmin();
    const read = await readVideoForViewer(admin, id, user);
    if (!read) return NOT_FOUND();
    if (!read.canManage) return NextResponse.json({ error: 'Only a manager can edit highlights.' }, { status: 403 });
    if (parsed.value.tag) {
      const tag = await prepareTag(admin, id, parsed.value.tag, user.id, highlightId, { orgId: read.row.org_id ?? null, profileId: read.row.profile_id ?? null });
      if (!tag.ok) return NextResponse.json({ error: tag.error }, { status: tag.status, headers: PRIVATE });
      parsed.value.tag = tag.value;
    }
    const updated = await updateHighlight(admin, id, highlightId, parsed.value, user.id);
    if (!updated.ok) return NextResponse.json({ error: updated.error }, { status: updated.status });
    const highlights = await listHighlights(admin, id, { id: user.id, canManage: true });
    return NextResponse.json({ highlight: updated.value, highlights }, { headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/videos/highlights/id] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE — a manager removes a marker. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id, highlightId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(highlightId)) return NOT_FOUND();
  try {
    const { user, error: authError, limited } = await getServerAuth(request, { limit: 'video-write' });
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (limited) return limited;
    const admin = getSupabaseAdmin();
    const read = await readVideoForViewer(admin, id, user);
    if (!read) return NOT_FOUND();
    if (!read.canManage) return NextResponse.json({ error: 'Only a manager can remove highlights.' }, { status: 403 });
    const gone = await deleteHighlight(admin, id, highlightId);
    if (!gone.ok) return NextResponse.json({ error: gone.error }, { status: gone.status });
    const highlights = await listHighlights(admin, id, { id: user.id, canManage: true });
    return NextResponse.json({ ok: true, highlights }, { headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/videos/highlights/id] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
