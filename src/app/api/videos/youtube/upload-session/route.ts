import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireActiveWriter } from '@/lib/auth-server';
import { reportRouteError } from '@/lib/observability/report';
import { CALL_REFUSALS, callRefusalWord, isScopeRefusal, parseOwnerRef, parseUploadSessionBody, scopeAllows } from '@/lib/videos/youtube-connection';
import { callWithToken, dropScope, uploadRight } from '@/lib/videos/youtube-connections-server';
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
    if (!right.ok) return NextResponse.json({ error: right.error, ...(right.reconnect ? { reconnect: true } : {}) }, { status: right.status });
    if (!scopeAllows(right.value.scopes, 'upload')) {
      return NextResponse.json({ error: 'Allow uploads to this channel first', needs_scope: 'upload' }, { status: 409 });
    }
    // A 401 is one forced refresh and one more try (callWithToken); the token handed to the device is the one that worked.
    const origin = request.headers.get('origin') || new URL(request.url).origin;
    const called = await callWithToken(admin, cfg, owner, token => youtubeCreateUploadSession(cfg, token, parsed.value, origin));
    if (!called.ok) return NextResponse.json({ error: called.error, reconnect: called.reconnect }, { status: called.status });
    const session = called.value;
    if (!session.ok) {
      // The row claimed a permission the token does not have (another Google account, a withdrawn box): stop claiming it and ask once more.
      if (isScopeRefusal(session.status, session.reason)) {
        await dropScope(admin, called.row, 'upload');
        return NextResponse.json({ error: 'Allow uploads to this channel first', needs_scope: 'upload' }, { status: 409 });
      }
      const word = callRefusalWord(session.status, session.reason);
      const error = word === 'refused' ? 'YouTube refused the upload for this channel' : word === 'busy' ? 'YouTube did not open the upload — try again' : CALL_REFUSALS[word].error;
      return NextResponse.json({ error }, { status: CALL_REFUSALS[word].status });
    }
    return NextResponse.json(
      { session_uri: session.sessionUri, access_token: called.accessToken, chunk_bytes: 8 * 1024 * 1024 },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[videos/youtube] upload session error:', error);
    return NextResponse.json({ error: 'Failed to start the upload' }, { status: 500 });
  }
}
