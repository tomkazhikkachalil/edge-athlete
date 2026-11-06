import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { listLiveVideos } from '@/lib/videos/videos-server';
import { refreshLiveViews } from '@/lib/videos/videos-live-server';
import { reportRouteError } from '@/lib/observability/report';

/**
 * GET /api/videos/live-now — the broadcasts streaming RIGHT NOW that this
 * viewer may see (Videos program Phase 4a, PR B): published rows with
 * `live_status = 'live'` under the owner's own rule — a profile's privacy
 * for a viewer (a follow counts), public for a stranger; an org's reach
 * (public, or a member). Signed out answers too (a public org's broadcast
 * is a place anyone can watch). Newest start first, at most ten. The rows
 * about to be shown are refreshed when due, so a stream that ended drops
 * off on the next look. Viewer-dependent: `private`, never a CDN copy.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getServerAuth(request);
    const viewerId = user?.id ?? null;
    const admin = getSupabaseAdmin();
    const listed = await listLiveVideos(admin, viewerId);
    const videos = (await refreshLiveViews(admin, listed)) ? await listLiveVideos(admin, viewerId) : listed;
    return NextResponse.json({ videos }, { headers: { 'Cache-Control': 'private, max-age=10' } });
  } catch (error) {
    reportRouteError('[api/videos/live-now] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
