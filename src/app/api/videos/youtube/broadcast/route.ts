import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireActiveWriter } from '@/lib/auth-server';
import { reportRouteError } from '@/lib/observability/report';
import { watchUrl } from '@/lib/videos/youtube';
import { BROADCAST_ERRORS, broadcastErrorWord, hasScope, parseBroadcastBody, parseOwnerRef, studioUrlFor } from '@/lib/videos/youtube-connection';
import { broadcastRight, callWithToken } from '@/lib/videos/youtube-connections-server';
import { youtubeBindBroadcast, youtubeConfig, youtubeCreateBroadcast, youtubeCreateStream, youtubeDeleteBroadcast } from '@/lib/videos/google-youtube-server';

const PRIVATE = { 'Cache-Control': 'private, no-store' } as const;

/**
 * POST /api/videos/youtube/broadcast — schedule a live broadcast on the
 * connected channel (Videos program Phase 4b): the broadcast, one new
 * stream, the bind. The STREAM KEY comes back in this answer ONCE and is
 * never stored or logged; the row the flow then creates holds the video id
 * only, and Phase 4a's first read makes it `upcoming`.
 *
 * Gates: the write gate + the video-write bucket; the broadcast right (the
 * owner's manager AND the person whose Google account made the connection,
 * on a standing connection); the `live` scope — without it 409
 * `{ needs_scope: 'live' }` and the screen sends them through /start?scope=live
 * once. The channel's own eligibility comes back in our words (403 + `reason`).
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveWriter(request, { limit: 'video-write' });
    const body = await request.json().catch(() => ({}));
    const owner = parseOwnerRef(body?.owner);
    if (!owner) return NextResponse.json({ error: 'Unknown owner' }, { status: 400 });
    const parsed = parseBroadcastBody(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const cfg = youtubeConfig();
    if (!cfg) return NextResponse.json({ error: 'YouTube connections are not available here' }, { status: 404 });

    const admin = getSupabaseAdmin();
    const right = await broadcastRight(admin, owner, user.id);
    if (!right.ok) return NextResponse.json({ error: right.error, ...(right.reconnect ? { reconnect: true } : {}) }, { status: right.status });
    if (!hasScope(right.value.scopes, 'live')) {
      return NextResponse.json({ error: 'Allow live broadcasts on this channel first', needs_scope: 'live' }, { status: 409 });
    }
    const refused = (status: number, reason: string | null) => {
      const word = broadcastErrorWord(status, reason);
      return NextResponse.json({ error: BROADCAST_ERRORS[word], reason: word }, { status: status === 403 ? 403 : 503 });
    };

    // The first write goes through the retry (a 401 = one forced refresh, one more try); the two that follow use the token that just worked.
    const called = await callWithToken(admin, cfg, owner, token => youtubeCreateBroadcast(cfg, token, parsed.value));
    if (!called.ok) return NextResponse.json({ error: called.error, reconnect: called.reconnect }, { status: called.status });
    const broadcast = called.value;
    const accessToken = called.accessToken;
    if (!broadcast.ok) return refused(broadcast.status, broadcast.reason);
    const stream = await youtubeCreateStream(cfg, accessToken, parsed.value.title);
    if (!stream.ok) {
      await youtubeDeleteBroadcast(cfg, accessToken, broadcast.value.videoId);
      return refused(stream.status, stream.reason);
    }
    const bound = await youtubeBindBroadcast(cfg, accessToken, broadcast.value.videoId, stream.value.streamId);
    if (!bound.ok) {
      await youtubeDeleteBroadcast(cfg, accessToken, broadcast.value.videoId);
      return refused(bound.status, bound.reason);
    }
    return NextResponse.json(
      {
        video_id: broadcast.value.videoId,
        watch_url: watchUrl(broadcast.value.videoId),
        studio_url: studioUrlFor(broadcast.value.videoId),
        stream_key: stream.value.streamKey,
        rtmps_url: stream.value.rtmpsUrl,
        rtmp_url: stream.value.rtmpUrl,
        scheduled_start_at: parsed.value.scheduledStartAt,
      },
      { headers: PRIVATE }
    );
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[videos/youtube] broadcast error:', error);
    return NextResponse.json({ error: 'Failed to schedule the broadcast' }, { status: 500 });
  }
}
