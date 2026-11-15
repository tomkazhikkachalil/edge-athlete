import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { resolveActingProfile } from '@/lib/guardian-gate';
import { parseHideBody, setFilmHidden } from '@/lib/sport-profile/film-hide-server';
import { reportRouteError } from '@/lib/observability/report';

const PRIVATE = { 'Cache-Control': 'private, no-store' };

/**
 * POST /api/profile/[profileId]/film-hidden {video_id, highlight_id?, hidden}
 * — the athlete hides a game (no highlight_id) or one clip from their own
 * page, or shows it again (migration 311; Tom, Nov 15 2026). The stat still
 * counts; "Remove me" is the stronger door. Only the athlete or their
 * guardian (the one acting-as gate); only something they are tagged in.
 * 200 {ok}.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    const { profileId } = await params;
    if (!isUuid(profileId)) return NextResponse.json({ error: 'Profile not found' }, { status: 404, headers: PRIVATE });
    const { user, error: authError, limited } = await getServerAuth(request, { limit: 'settings-write' });
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (limited) return limited;
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const parsed = parseHideBody(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: PRIVATE });
    const acting = await resolveActingProfile(user.id, profileId, 'Only the athlete or their guardian can hide this');
    if (!acting.ok) return NextResponse.json({ error: acting.error }, { status: acting.status, headers: PRIVATE });
    const saved = await setFilmHidden(getSupabaseAdmin(), acting.actorId, user.id, parsed.value);
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: saved.status, headers: PRIVATE });
    return NextResponse.json({ ok: true }, { headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/profile/film-hidden] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
