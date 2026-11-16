import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { isUuid } from '@/lib/uuid';
import { reportRouteError } from '@/lib/observability/report';
import { resolveActivityAccess } from '@/lib/activities/read-server';
import { aspectHidden } from '@/lib/training-privacy';
import { fetchTrainingPrivacy } from '@/lib/training-privacy-server';
import { readTrainingTimeline } from '@/lib/training/timeline-server';

/**
 * GET /api/profile/[profileId]/training/timeline — Training's Year → Month →
 * Week views ("one wave", phase 2, Nov 2026): every session this viewer may
 * see as one narrow row (when, how long, how far, how hard, its name). The
 * page groups them in the viewer's own calendar (src/lib/training/timeline.ts).
 *   → { sessions: TimelineSession[], capped, isOwner }   or   { sessions: [], hidden: true }
 *
 * The gate is History's own: resolveActivityAccess (blocks, a departed
 * athlete, supervision, guardians as the owner), then the Training privacy
 * `workouts` aspect. A non-owner never receives a workout the owner hid or
 * has not decided, nor an "Only me" activity (timeline-server.ts).
 * Viewer-dependent: `private, no-store`.
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    const { profileId } = await params;
    if (!isUuid(profileId)) return NextResponse.json({ error: 'Profile not found' }, { status: 404, headers: NO_STORE });
    const { user } = await getServerAuth(request);
    const admin = getSupabaseAdmin();
    const access = await resolveActivityAccess(admin, user?.id ?? null, profileId);
    if (!access.ok) return NextResponse.json({ error: 'Profile not found' }, { status: 404, headers: NO_STORE });
    const isOwner = access.audience === 'owner';
    if (!isOwner && aspectHidden(await fetchTrainingPrivacy(admin, profileId), 'workouts', isOwner)) {
      return NextResponse.json({ sessions: [], capped: false, isOwner: false, hidden: true }, { headers: NO_STORE });
    }
    const timeline = await readTrainingTimeline(admin, profileId, access.audience);
    if (!timeline.ok) return NextResponse.json({ error: 'Could not load training' }, { status: 500, headers: NO_STORE });
    return NextResponse.json({ sessions: timeline.sessions, capped: timeline.capped, isOwner }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[training/timeline] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}
