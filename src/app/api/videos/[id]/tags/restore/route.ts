import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { resolveActingProfile } from '@/lib/guardian-gate';
import { parseRestoreBody } from '@/lib/videos/tag-rules';
import { restoreTagsOf } from '@/lib/videos/videos-server';
import { reportRouteError } from '@/lib/observability/report';

const PRIVATE = { 'Cache-Control': 'private, no-store' };

/**
 * POST /api/videos/[id]/tags/restore[?profileId=…] {ids} — Undo of a removal
 * (round 2 PR 5, Nov 13 2026). The same gate as the removal (your own name,
 * or your supervised athlete's — no right over the video), and only the rows
 * the removal answered with, removed by YOU, in the last ten minutes. Nothing
 * is revealed: ids that are not yours to restore answer `restored: 0`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Video not found' }, { status: 404, headers: PRIVATE });
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
    const parsed = parseRestoreBody(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: PRIVATE });
    const acting = await resolveActingProfile(user.id, request.nextUrl.searchParams.get('profileId'), 'Only the tagged person or their guardian can put these tags back');
    if (!acting.ok) return NextResponse.json({ error: acting.error }, { status: acting.status });
    const back = await restoreTagsOf(getSupabaseAdmin(), id, acting.actorId, user.id, parsed.value.ids);
    if (!back.ok) return NextResponse.json({ error: back.error }, { status: back.status });
    return NextResponse.json({ restored: back.value.restored }, { headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/videos/id/tags/restore] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
