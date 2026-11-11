import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { reportRouteError } from '@/lib/observability/report';
import { CALL_REFUSALS, callRefusalWord, parseOwnerRef, uploadsPlaylistFor } from '@/lib/videos/youtube-connection';
import { callWithToken, ownerManaged, readConnection } from '@/lib/videos/youtube-connections-server';
import { youtubeChannelUploads, youtubeConfig } from '@/lib/videos/google-youtube-server';

/**
 * GET /api/videos/youtube/channel-uploads?owner=… — the connected channel's
 * own uploads, newest first: the ids a manager links in one tap (the
 * readonly scope). Managers only; the token refreshed on the way if stale,
 * and once more on a 401 (callWithToken). A refusal says what it is: a
 * connection to make again (`reconnect: true`), YouTube's daily limit, or
 * no answer.
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
    const PRIVATE = { 'Cache-Control': 'private, no-store' };
    const connection = await readConnection(admin, owner);
    const playlist = connection.row ? uploadsPlaylistFor(connection.row.channel_id) : null;
    if (connection.row && !playlist) return NextResponse.json({ uploads: [] }, { headers: PRIVATE });
    const called = await callWithToken(admin, cfg, owner, token => youtubeChannelUploads(cfg, token, playlist ?? ''));
    if (!called.ok) return NextResponse.json({ error: called.error, reconnect: called.reconnect }, { status: called.status, headers: PRIVATE });
    const read = called.value;
    if (!read.ok) {
      const refused = CALL_REFUSALS[callRefusalWord(read.status, read.reason)];
      return NextResponse.json({ error: refused.error }, { status: refused.status, headers: PRIVATE });
    }
    return NextResponse.json({ uploads: read.value }, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[videos/youtube] channel uploads error:', error);
    return NextResponse.json({ error: 'Failed to read the channel' }, { status: 500 });
  }
}
