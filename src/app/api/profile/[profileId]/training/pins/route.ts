import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { isUuid } from '@/lib/uuid';
import { reportRouteError } from '@/lib/observability/report';
import { resolveActivityAccess } from '@/lib/activities/read-server';
import { aspectHidden } from '@/lib/training-privacy';
import { fetchTrainingPrivacy } from '@/lib/training-privacy-server';
import { readPins, resolvePins } from '@/lib/training/pins-server';

/**
 * GET /api/profile/[profileId]/training/pins — the bests an athlete pinned to
 * the top of Training (Training redesign PR 7, Nov 11 2026), each with the
 * number THIS viewer may see:
 *   → { pins: [{ pin, label, kindLabel, display }], isOwner, mine? }
 * `mine` (the athlete only) is the raw list, in order — a pin whose exercise
 * has no number right now is still one of the six and can still be unpinned.
 *
 * The gate is the activity readers' ONE gate, then the Training privacy
 * `records` aspect (`hidden: true`, nothing else). A value is never stored
 * with a pin: an exercise's is folded for this viewer (a visitor's from the
 * sessions they may open), a test's read from the athlete's test results.
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
    if (!isOwner && aspectHidden(await fetchTrainingPrivacy(admin, profileId), 'records', isOwner)) {
      return NextResponse.json({ pins: [], isOwner: false, hidden: true }, { headers: NO_STORE });
    }
    const pins = await readPins(admin, profileId);
    const resolved = await resolvePins(admin, profileId, pins, { visitor: !isOwner });
    return NextResponse.json({ pins: resolved, isOwner, ...(user?.id === profileId ? { mine: pins } : {}) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[training/pins] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}
