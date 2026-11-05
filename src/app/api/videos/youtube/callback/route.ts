import { NextRequest, NextResponse } from 'next/server';
import { activeWriterRefusal, getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { reportRouteError } from '@/lib/observability/report';
import { returnPathFor } from '@/lib/videos/youtube-connection';
import { connectYouTube, ownerManaged } from '@/lib/videos/youtube-connections-server';
import { isPkceVerifier, youtubeConfig, youtubeExchangeCode, youtubeMyChannel } from '@/lib/videos/google-youtube-server';
import { callbackUri, PKCE_COOKIE, pkceCookieOptions, readConnectState } from '@/lib/videos/youtube-oauth-server';

/**
 * GET /api/videos/youtube/callback — Google sends the person back here with
 * a code (Videos program Phase 3). Also a navigation: it always ends in a
 * redirect to the owner's Videos surface, `youtube=connected` or
 * `youtube_error=<reason>`.
 *
 * In order: the session; the SIGNED state (this account, this owner, this
 * scope, ten minutes); the PKCE verifier from the cookie (cleared either
 * way); the manage and moderation checks again; code → tokens (a refresh
 * token is required — prompt=consent asks for it every time); the channel of
 * the account that said yes (none → `nochannel`); the row, sealed.
 */
export const maxDuration = 60;

const back = (request: NextRequest, path: string) => {
  const res = NextResponse.redirect(new URL(path, request.url), 302);
  res.cookies.set(PKCE_COOKIE, '', { ...pkceCookieOptions(request), maxAge: 0 });
  return res;
};
const FALLBACK = '/athlete?youtube_error=failed&tab=videos';

export async function GET(request: NextRequest) {
  try {
    const { user } = await getServerAuth(request);
    if (!user) return NextResponse.redirect(new URL('/?signin=1', request.url), 302);
    const params = request.nextUrl.searchParams;
    const state = readConnectState(params.get('state'), user.id);
    if (!state) return back(request, FALLBACK.replace('failed', 'expired'));
    const { owner, scope } = state;
    const err = (word: string) => back(request, returnPathFor(owner, `youtube_error=${word}`));

    const cfg = youtubeConfig();
    if (!cfg) return err('unavailable');
    if (params.get('error')) return err('denied');
    const code = params.get('code');
    if (!code || code.length > 512) return err('failed');
    const verifier = request.cookies.get(PKCE_COOKIE)?.value;
    if (!isPkceVerifier(verifier)) return err('expired');

    const admin = getSupabaseAdmin();
    if (!(await ownerManaged(admin, owner, user.id))) return err('forbidden');
    if (await activeWriterRefusal(user.id)) return err('limited');

    const tokens = await youtubeExchangeCode(cfg, code, callbackUri(request), verifier);
    if (!tokens.ok || !tokens.refreshToken) return err('failed');
    const channel = await youtubeMyChannel(cfg, tokens.accessToken);
    if (!channel.ok) return err('failed');
    if (!channel.value) return err('nochannel');

    const connected = await connectYouTube(admin, {
      owner,
      userId: user.id,
      channelId: channel.value.id,
      channelTitle: channel.value.title || null,
      grantedScope: tokens.scope,
      secret: { refreshToken: tokens.refreshToken, accessToken: tokens.accessToken, expiresAt: tokens.expiresAt },
    });
    if (!connected.ok) return err(connected.status === 503 ? 'unavailable' : 'failed');
    return back(request, returnPathFor(owner, `youtube=connected&scope=${scope}`));
  } catch (error) {
    reportRouteError('[videos/youtube] callback error:', error);
    return back(request, FALLBACK);
  }
}
