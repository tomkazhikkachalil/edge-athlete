import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { parseHighlightBody, type HighlightInput } from '@/lib/videos/rules';
import { CHAPTER_MAX_COUNT } from '@/lib/videos/youtube-connection';
import { addHighlights, listHighlights, readVideoForViewer } from '@/lib/videos/videos-server';
import { reportRouteError } from '@/lib/observability/report';

const PRIVATE = { 'Cache-Control': 'private, no-store' };
const NOT_FOUND = () => NextResponse.json({ error: 'Video not found' }, { status: 404, headers: PRIVATE });

/**
 * POST {highlights: [{start_ms, end_ms?, label, meta?}, …]} — YouTube's
 * chapters as markers in ONE write (paste and go, Nov 6 2026): a manager,
 * the video-write bucket once, at most CHAPTER_MAX_COUNT rows, each parsed
 * by the one highlight rule; refused (409) when the video already has any
 * highlight. 201 {highlights}.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NOT_FOUND();
  try {
    const { user, error: authError, limited } = await getServerAuth(request, { limit: 'video-write' });
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (limited) return limited;
    const body = (await request.json().catch(() => null)) as { highlights?: unknown } | null;
    const raw = Array.isArray(body?.highlights) ? body!.highlights : null;
    if (!raw || raw.length === 0) return NextResponse.json({ error: 'highlights must be a non-empty list' }, { status: 400 });
    if (raw.length > CHAPTER_MAX_COUNT) return NextResponse.json({ error: `At most ${CHAPTER_MAX_COUNT} highlights at once` }, { status: 400 });
    const inputs: HighlightInput[] = [];
    for (const item of raw) {
      const parsed = parseHighlightBody(item);
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
      inputs.push(parsed.value);
    }
    const admin = getSupabaseAdmin();
    const read = await readVideoForViewer(admin, id, user);
    if (!read) return NOT_FOUND();
    if (!read.canManage) return NextResponse.json({ error: 'Only a manager can add highlights.' }, { status: 403 });
    const added = await addHighlights(admin, id, inputs, user.id);
    if (!added.ok) return NextResponse.json({ error: added.error }, { status: added.status });
    const highlights = await listHighlights(admin, id);
    return NextResponse.json({ highlights, added: added.value.length }, { status: 201, headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/videos/highlights/import] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
