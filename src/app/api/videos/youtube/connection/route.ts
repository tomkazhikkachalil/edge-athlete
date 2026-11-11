import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { reportRouteError } from '@/lib/observability/report';
import { parseOwnerRef } from '@/lib/videos/youtube-connection';
import { enforceRateLimit } from '@/lib/rate-limit';
import { checkConnection, connectionViewFor, disconnectYouTube, ownerManaged } from '@/lib/videos/youtube-connections-server';
import { youtubeConfig } from '@/lib/videos/google-youtube-server';

/**
 * GET /api/videos/youtube/connection?owner=…  — the owner's connection as the
 * screen sees it (never the secret), for the owner's MANAGERS only (the
 * videos' refusal: a 404). `&check=1` first asks YouTube whether the
 * connection still stands (one unit of quota, the video-lookup bucket; the
 * card asks at most every ten minutes) — a dead grant shows as `revoked`
 * now, not at the next upload. DELETE — disconnect: revoke at Google best effort,
 * the row goes, the videos it uploaded stay. Both private, no-store.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getServerAuth(request);
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const owner = parseOwnerRef(request.nextUrl.searchParams.get('owner'));
    if (!owner) return NextResponse.json({ error: 'Unknown owner' }, { status: 400 });
    const admin = getSupabaseAdmin();
    if (!(await ownerManaged(admin, owner, user.id))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (request.nextUrl.searchParams.get('check') === '1') {
      const limited = await enforceRateLimit(request, 'video-lookup', { userId: user.id });
      const cfg = youtubeConfig();
      if (!limited && cfg) await checkConnection(admin, cfg, owner);
    }
    const view = await connectionViewFor(admin, owner, user.id);
    return NextResponse.json({ connection: view }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[videos/youtube] connection read error:', error);
    return NextResponse.json({ error: 'Failed to read the connection' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user, limited } = await getServerAuth(request, { limit: 'connection-write' });
    if (limited) return limited;
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const owner = parseOwnerRef(request.nextUrl.searchParams.get('owner'));
    if (!owner) return NextResponse.json({ error: 'Unknown owner' }, { status: 400 });
    const admin = getSupabaseAdmin();
    if (!(await ownerManaged(admin, owner, user.id))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const result = await disconnectYouTube(admin, owner);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ removed: result.value.removed }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[videos/youtube] disconnect error:', error);
    return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 });
  }
}
