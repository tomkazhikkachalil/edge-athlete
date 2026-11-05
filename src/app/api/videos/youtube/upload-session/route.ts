import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireActiveWriter } from '@/lib/auth-server';
import { reportRouteError } from '@/lib/observability/report';
import { hasScope, parseOwnerRef, parseUploadSessionBody } from '@/lib/videos/youtube-connection';
import { recordError, uploadRight, withAccessToken } from '@/lib/videos/youtube-connections-server';
import { youtubeConfig, youtubeCreateUploadSession } from '@/lib/videos/google-youtube-server';

/**
 * POST /api/videos/youtube/upload-session — open a resumable upload at
 * YouTube for the connected channel (Videos program Phase 3). The server
 * holds the tokens and creates the session; the DEVICE then PUTs the bytes
 * to the session URI with the hour-long access token this answers — the
 * connector's own, short-lived, never the refresh token; the bytes never
 * pass through Edge Athlete or Vercel.
 *
 * Gates: the write gate + the video-write bucket; the upload right (the
 * owner's manager AND the person whose Google account made the connection,
 * on a standing connection); the `upload` scope — without it the answer is
 * 409 `{ needs_scope: 'upload' }` and the screen sends them through
 * /start?scope=upload once.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveWriter(request, { limit: 'video-write' });
    const body = await request.json().catch(() => ({}));
    const owner = parseOwnerRef(body?.owner);
    if (!owner) return NextResponse.json({ error: 'Unknown owner' }, { status: 400 });
    const parsed = parseUploadSessionBody(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const cfg = youtubeConfig();
    if (!cfg) return NextResponse.json({ error: 'YouTube connections are not available here' }, { status: 404 });

    const admin = getSupabaseAdmin();
    const right = await uploadRight(admin, owner, user.id);
    if (!right.ok) return NextResponse.json({ error: right.error }, { status: right.status });
    if (!hasScope(right.value.scopes, 'upload')) {
      return NextResponse.json({ error: 'Allow uploads to this channel first', needs_scope: 'upload' }, { status: 409 });
    }
    const token = await withAccessToken(admin, cfg, owner);
    if (!token.ok) return NextResponse.json({ error: token.error }, { status: token.status });
    const session = await youtubeCreateUploadSession(cfg, token.accessToken, parsed.value);
    if (!session.ok) {
      if (session.unauthorized) await recordError(admin, token.row.id, 'YouTube refused the upload — reconnect');
      return NextResponse.json({ error: session.status === 403 ? 'YouTube refused the upload for this channel' : 'YouTube did not open the upload — try again' }, { status: session.status === 403 ? 403 : 503 });
    }
    return NextResponse.json(
      { session_uri: session.sessionUri, access_token: token.accessToken, chunk_bytes: 8 * 1024 * 1024 },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[videos/youtube] upload session error:', error);
    return NextResponse.json({ error: 'Failed to start the upload' }, { status: 500 });
  }
}
