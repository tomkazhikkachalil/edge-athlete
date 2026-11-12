import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { reportRouteError } from '@/lib/observability/report';
import { liveStateFromApi } from '@/lib/videos/live-rules';
import { parseChapters, parseOwnerRef, type ChannelVerdict, type VideoLookup } from '@/lib/videos/youtube-connection';
import { ownerManaged, videoChannelCheck } from '@/lib/videos/youtube-connections-server';
import { youtubeReadConfig, youtubeVideoLookup, type LiveDetails } from '@/lib/videos/google-youtube-server';

const PRIVATE = { 'Cache-Control': 'private, no-store' } as const;
const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const UNAVAILABLE: VideoLookup = { available: false, title: null, thumbnail: null, durationMs: null, privacy: null, embeddable: null, live: null, chapters: [] };

/**
 * GET /api/videos/youtube/lookup?id=<11 chars>[&owner=profile:…|club:…|league:…]
 * What YouTube says about a pasted id (paste and go, Nov 6 2026): the title,
 * the poster, the duration, the privacy and whether it embeds, the live
 * state, and the chapters in its description — so the flow fills itself in
 * and says at once when a video will play for nobody — and, since Nov 11
 * 2026, WHOSE it is (`lookup.channel`: only the owner's connected channel's
 * videos are added). Read through the
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
    const owner = parseOwnerRef(request.nextUrl.searchParams.get('owner'));
    // Only the connected channel (Nov 11 2026): for an owner the caller manages, the SAME read says whose video it is.
    let read: { value: LiveDetails | null } | null = null;
    let channel: ChannelVerdict | null = null;
    let channelTitle: string | null = null;
    if (owner && (await ownerManaged(admin, owner, user.id))) {
      const check = await videoChannelCheck(admin, owner, id);
      if (check.enforced) {
        channel = check.verdict;
        channelTitle = check.channelTitle;
        if (check.verdict !== 'unconnected' && check.verdict !== 'unreadable') read = { value: check.details };
      }
    }
    if (!read) {
      const key = youtubeReadConfig();
      const viaKey = key ? await youtubeVideoLookup({ apiBase: key.apiBase, apiKey: key.apiKey }, id) : null;
      if (!viaKey?.ok) return NextResponse.json({ lookup: { ...UNAVAILABLE, channel, channelTitle } }, { headers: PRIVATE });
      read = viaKey;
    }
    if (!read.value) return NextResponse.json({ lookup: { ...UNAVAILABLE, available: true, channel, channelTitle }, missing: true }, { headers: PRIVATE });
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
      channel,
      channelTitle,
    };
    return NextResponse.json({ lookup }, { headers: PRIVATE });
  } catch (error) {
    reportRouteError('[videos/youtube] lookup error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
