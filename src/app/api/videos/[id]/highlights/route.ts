import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { markNowOffsetMs } from '@/lib/videos/live-rules';
import { parseHighlightBody } from '@/lib/videos/rules';
import { addHighlight, listHighlights, readVideoForViewer } from '@/lib/videos/videos-server';
import { reportRouteError } from '@/lib/observability/report';

const PRIVATE = { 'Cache-Control': 'private, no-store' };
const NOT_FOUND = () => NextResponse.json({ error: 'Video not found' }, { status: 404, headers: PRIVATE });

/** POST {start_ms, end_ms?, label, meta?} — a manager adds a marker. 201 {highlight, highlights}. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NOT_FOUND();
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
    const parsed = parseHighlightBody(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const admin = getSupabaseAdmin();
    const read = await readVideoForViewer(admin, id, user);
    if (!read) return NOT_FOUND();
    if (!read.canManage) return NextResponse.json({ error: 'Only a manager can add highlights.' }, { status: 403 });
    // Phase 4a: a marker made DURING the broadcast — its time is the server's clock against YouTube's actual start, never the device's.
    if (parsed.value.meta.live) {
      const offset = read.row.live_status === 'live' ? markNowOffsetMs(read.row.live_started_at, Date.now()) : null;
      if (offset === null) return NextResponse.json({ error: 'The broadcast is not live right now.' }, { status: 409, headers: PRIVATE });
      parsed.value.start_ms = offset;
      if (parsed.value.end_ms !== null && parsed.value.end_ms <= offset) parsed.value.end_ms = null;
    }
    const added = await addHighlight(admin, id, parsed.value, user.id);
    if (!added.ok) return NextResponse.json({ error: added.error }, { status: added.status });
    const highlights = await listHighlights(admin, id);
    return NextResponse.json({ highlight: added.value, highlights }, { status: 201, headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/videos/highlights] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
