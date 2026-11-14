import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { resolveActingProfile } from '@/lib/guardian-gate';
import { removeTagsOf } from '@/lib/videos/videos-server';
import { reportRouteError } from '@/lib/observability/report';

const PRIVATE = { 'Cache-Control': 'private, no-store' };

/**
 * DELETE /api/videos/[id]/tags[?profileId=…][&highlightId=…] — the tagged
 * person removes the tags of THEM on this video (Sprint 3 PR 7): every one,
 * or one highlight's. A guardian does it for a supervised athlete
 * (`profileId`, the one acting-as gate). No right over the video is needed
 * or checked — it is your own name — and nothing is revealed: a video you
 * are not tagged in answers `removed: 0`. The rows stay as `removed`, so a
 * manager's later save never tags you back in; the stat drops with them.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Video not found' }, { status: 404, headers: PRIVATE });
  try {
    const { user, error: authError, limited } = await getServerAuth(request, { limit: 'video-write' });
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (limited) return limited;
    const highlightId = request.nextUrl.searchParams.get('highlightId');
    if (highlightId !== null && !UUID_RE.test(highlightId)) return NextResponse.json({ error: 'Unknown highlight' }, { status: 400 });
    const acting = await resolveActingProfile(user.id, request.nextUrl.searchParams.get('profileId'), 'Only the tagged person or their guardian can remove these tags');
    if (!acting.ok) return NextResponse.json({ error: acting.error }, { status: acting.status });
    const gone = await removeTagsOf(getSupabaseAdmin(), id, acting.actorId, user.id, highlightId);
    if (!gone.ok) return NextResponse.json({ error: gone.error }, { status: gone.status });
    // The ids are the handle for Undo (POST …/tags/restore): exactly these rows, by whoever removed them, for ten minutes.
    return NextResponse.json({ removed: gone.value.removed, ids: gone.value.ids }, { headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/videos/id/tags] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
