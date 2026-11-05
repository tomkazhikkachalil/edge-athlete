import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { reportRouteError } from '@/lib/observability/report';
import { parseOwnerRef, uploadsPlaylistFor } from '@/lib/videos/youtube-connection';
import { ownerManaged, recordError, withAccessToken } from '@/lib/videos/youtube-connections-server';
import { youtubeChannelUploads, youtubeConfig } from '@/lib/videos/google-youtube-server';

/**
 * GET /api/videos/youtube/channel-uploads?owner=… — the connected channel's
 * own uploads, newest first: the ids a manager links in one tap (the
 * readonly scope). Managers only; the token refreshed on the way if stale.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getServerAuth(request);
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const owner = parseOwnerRef(request.nextUrl.searchParams.get('owner'));
    if (!owner) return NextResponse.json({ error: 'Unknown owner' }, { status: 400 });
    const cfg = youtubeConfig();
    if (!cfg) return NextResponse.json({ error: 'YouTube connections are not available here' }, { status: 404 });
    const admin = getSupabaseAdmin();
    if (!(await ownerManaged(admin, owner, user.id))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const token = await withAccessToken(admin, cfg, owner);
    if (!token.ok) return NextResponse.json({ error: token.error }, { status: token.status });
    const playlist = uploadsPlaylistFor(token.row.channel_id);
    if (!playlist) return NextResponse.json({ uploads: [] }, { headers: { 'Cache-Control': 'private, no-store' } });
    const read = await youtubeChannelUploads(cfg, token.accessToken, playlist);
    if (!read.ok) {
      if (read.unauthorized) await recordError(admin, token.row.id, 'YouTube refused the channel read — reconnect');
      return NextResponse.json({ error: 'YouTube did not answer — try again' }, { status: 503 });
    }
    return NextResponse.json({ uploads: read.value }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[videos/youtube] channel uploads error:', error);
    return NextResponse.json({ error: 'Failed to read the channel' }, { status: 500 });
  }
}
