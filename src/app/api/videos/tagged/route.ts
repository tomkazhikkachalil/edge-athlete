import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { canViewProfile } from '@/lib/privacy';
import { listTaggedGames } from '@/lib/videos/video-tagged-server';
import { anonymousProfileCanView, profileManages } from '@/lib/videos/videos-server';
import { reportRouteError } from '@/lib/observability/report';

const PRIVATE = { 'Cache-Control': 'private, no-store' };
const NOT_FOUND = () => NextResponse.json({ error: 'Profile not found' }, { status: 404, headers: PRIVATE });

/**
 * GET /api/videos/tagged?profileId=… — the games this athlete was tagged in
 * (Sprint 3 PR 7): each with its link back, how many clips they are in, and
 * their line for the game. Who may ask is the profile's own privacy; which
 * games answer is each video's own rule; `can_remove` says the viewer is
 * the athlete or their guardian (they may remove the tags).
 */
export async function GET(request: NextRequest) {
  try {
    const profileId = request.nextUrl.searchParams.get('profileId') ?? '';
    if (!UUID_RE.test(profileId)) return NOT_FOUND();
    const { user } = await getServerAuth(request);
    const admin = getSupabaseAdmin();
    const acts = user ? await profileManages(user.id, profileId) : false;
    const canView = acts || (user ? (await canViewProfile(profileId, user.id)).canView : await anonymousProfileCanView(admin, profileId));
    if (!canView) return NOT_FOUND();
    const games = await listTaggedGames(admin, profileId, user ?? null, acts);
    return NextResponse.json({ games, can_remove: acts }, { headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/videos/tagged] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
