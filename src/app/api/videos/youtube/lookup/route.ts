import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { reportRouteError } from '@/lib/observability/report';
import { liveStateFromApi } from '@/lib/videos/live-rules';
import { parseChapters, parseOwnerRef, type VideoLookup } from '@/lib/videos/youtube-connection';
import { ownerManaged, withAccessToken } from '@/lib/videos/youtube-connections-server';
import { youtubeConfig, youtubeReadConfig, youtubeVideoLookup } from '@/lib/videos/google-youtube-server';

const PRIVATE = { 'Cache-Control': 'private, no-store' } as const;
const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const UNAVAILABLE: VideoLookup = { available: false, title: null, thumbnail: null, durationMs: null, privacy: null, embeddable: null, live: null, chapters: [] };

/**
 * GET /api/videos/youtube/lookup?id=<11 chars>[&owner=profile:…|club:…|league:…]
 * What YouTube says about a pasted id (paste and go, Nov 6 2026): the title,
 * the poster, the duration, the privacy and whether it embeds, the live
 * state, and the chapters in its description — so the flow fills itself in
 * and says at once when a video will play for nobody. Read through the
 * owner's connection when the caller manages a connected owner (a private
 * video of their own), else the server-only key; neither → `available:
 * false` and the flow behaves as before. Signed in; one read per paste
 * (the video-lookup bucket); never cached.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getServerAuth(request);
    if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const limited = await enforceRateLimit(request, 'video-lookup', { userId: user.id });
    if (limited) return limited;
    const id = request.nextUrl.searchParams.get('id') ?? '';
    if (!ID_RE.test(id)) return NextResponse.json({ error: 'A YouTube video id is required' }, { status: 400 });

    const admin = getSupabaseAdmin();
    const cfg = youtubeConfig();
    const owner = parseOwnerRef(request.nextUrl.searchParams.get('owner'));
    let read = null;
    if (cfg && owner && (await ownerManaged(admin, owner, user.id))) {
      const token = await withAccessToken(admin, cfg, owner);
      if (token.ok) {
        const viaToken = await youtubeVideoLookup({ apiBase: cfg.apiBase, accessToken: token.accessToken }, id);
        if (viaToken.ok) read = viaToken;
      }
    }
    if (!read) {
      const key = youtubeReadConfig();
      if (!key) return NextResponse.json({ lookup: UNAVAILABLE }, { headers: PRIVATE });
      const viaKey = await youtubeVideoLookup({ apiBase: key.apiBase, apiKey: key.apiKey }, id);
      if (!viaKey.ok) return NextResponse.json({ lookup: UNAVAILABLE }, { headers: PRIVATE });
      read = viaKey;
    }
    if (!read.value) return NextResponse.json({ lookup: { ...UNAVAILABLE, available: true }, missing: true }, { headers: PRIVATE });
    const v = read.value;
    const state = liveStateFromApi(v);
    const lookup: VideoLookup = {
      available: true,
      title: v.title,
      thumbnail: v.thumbnail,
      durationMs: v.durationMs,
      privacy: v.privacy,
      embeddable: v.embeddable,
      live: { status: state.live_status, scheduledStartAt: state.scheduled_start_at },
      chapters: parseChapters(v.description),
    };
    return NextResponse.json({ lookup }, { headers: PRIVATE });
  } catch (error) {
    reportRouteError('[videos/youtube] lookup error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
