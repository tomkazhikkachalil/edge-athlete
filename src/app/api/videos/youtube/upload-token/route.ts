import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireActiveWriter } from '@/lib/auth-server';
import { reportRouteError } from '@/lib/observability/report';
import { parseOwnerRef, scopeAllows } from '@/lib/videos/youtube-connection';
import { uploadRight, withAccessToken } from '@/lib/videos/youtube-connections-server';
import { youtubeConfig } from '@/lib/videos/google-youtube-server';

const PRIVATE = { 'Cache-Control': 'private, no-store' } as const;

/**
 * POST /api/videos/youtube/upload-token { owner } — a FRESH hour-long access
 * token for an upload already in flight (the uploads round, Nov 10 2026): a
 * full game on a home connection outlives the token the session was opened
 * with, and an upload resumed after a reload has none at all. The device
 * asks here when YouTube answers 401 mid-upload, or before it resumes.
 *
 * The same gates as opening a session — the write gate + the video-write
 * bucket, the upload right (the owner's manager AND the connector, on a
 * standing connection), the upload permission — and the same promise: the
 * connector's own short-lived token, never the refresh token. The refresh is
 * FORCED, so the token handed out has its whole hour ahead of it. A
 * connection that is over answers 409 with `reconnect: true`.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveWriter(request, { limit: 'video-write' });
    const body = await request.json().catch(() => ({}));
    const owner = parseOwnerRef(body?.owner);
    if (!owner) return NextResponse.json({ error: 'Unknown owner' }, { status: 400 });
    const cfg = youtubeConfig();
    if (!cfg) return NextResponse.json({ error: 'YouTube connections are not available here' }, { status: 404 });

    const admin = getSupabaseAdmin();
    const right = await uploadRight(admin, owner, user.id);
    if (!right.ok) return NextResponse.json({ error: right.error, ...(right.reconnect ? { reconnect: true } : {}) }, { status: right.status, headers: PRIVATE });
    if (!scopeAllows(right.value.scopes, 'upload')) {
      return NextResponse.json({ error: 'Allow uploads to this channel first', needs_scope: 'upload' }, { status: 409, headers: PRIVATE });
    }
    const token = await withAccessToken(admin, cfg, owner, { force: true });
    if (!token.ok) return NextResponse.json({ error: token.error, reconnect: token.reconnect }, { status: token.status, headers: PRIVATE });
    return NextResponse.json({ access_token: token.accessToken }, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[videos/youtube] upload token error:', error);
    return NextResponse.json({ error: 'Failed to continue the upload' }, { status: 500 });
  }
}
