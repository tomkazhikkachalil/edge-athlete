import { NextRequest, NextResponse } from 'next/server';
import { activeWriterRefusal, getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { reportRouteError } from '@/lib/observability/report';
import { connectReturnPath, isScopeKey, landingFor, parseOwnerRef, returnPathFor, scopesFor } from '@/lib/videos/youtube-connection';
import { ownerManaged, youtubeConnectionsAvailable } from '@/lib/videos/youtube-connections-server';
import { pkcePair, youtubeAuthorizeUrl, youtubeConfig } from '@/lib/videos/google-youtube-server';
import { callbackUri, PKCE_COOKIE, pkceCookieOptions, RETURN_COOKIE, signConnectState } from '@/lib/videos/youtube-oauth-server';

/**
 * GET /api/videos/youtube/start?owner=profile:<id>|club:<id>|league:<id>&scope=readonly|upload|live[&return=<path>]
 * Send the person to Google to connect the owner's channel (Videos program
 * Phase 3, Nov 5 2026). A NAVIGATION (the Connect button is a link), so every
 * refusal is a redirect back to the owner's Videos surface with the reason —
 * never JSON in the address bar. The Polar start route's shape. `return`
 * (the flow round, Nov 10 2026) is the screen that asked — a path of this
 * app on `connectReturnPath`'s short list, kept in an httpOnly cookie beside
 * the verifier; the result lands there instead of the Videos surface.
 *
 * Refused: signed out; not configured or no sealing key; an owner the viewer
 * does not manage (the videos' rule: the person or a guardian, the org's
 * manage_video); the connection-write bucket; the moderation write gate.
 * The state is signed for THIS account, owner and scope; the PKCE verifier
 * rides an httpOnly cookie for ten minutes.
 */
const back = (request: NextRequest, path: string) => NextResponse.redirect(new URL(path, request.url), 302);

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const owner = parseOwnerRef(params.get('owner'));
  const fallback = owner ? returnPathFor(owner, 'youtube_error=failed') : '/athlete?youtube_error=failed&tab=videos';
  try {
    const { user } = await getServerAuth(request);
    if (!user) return NextResponse.redirect(new URL('/?signin=1', request.url), 302);
    if (!owner) return back(request, fallback);
    const scope = params.get('scope') ?? 'readonly';
    const returnTo = connectReturnPath(params.get('return'));
    const refuse = (word: string) => back(request, landingFor(owner, returnTo, `youtube_error=${word}`));
    if (!isScopeKey(scope)) return refuse('failed');

    const cfg = youtubeConfig();
    if (!cfg || !youtubeConnectionsAvailable()) return refuse('unavailable');

    const admin = getSupabaseAdmin();
    if (!(await ownerManaged(admin, owner, user.id))) return refuse('forbidden');
    const limited = await enforceRateLimit(request, 'connection-write', { userId: user.id });
    if (limited) return refuse('busy');
    if (await activeWriterRefusal(user.id)) return refuse('limited');

    const pkce = pkcePair();
    const url = youtubeAuthorizeUrl(cfg, {
      state: signConnectState(user.id, owner, scope),
      redirectUri: callbackUri(request),
      scopes: scopesFor(scope),
      codeChallenge: pkce.challenge,
    });
    const res = NextResponse.redirect(url, 302);
    res.cookies.set(PKCE_COOKIE, pkce.verifier, pkceCookieOptions(request));
    // The return path rides with the verifier; a start without one clears an older one.
    res.cookies.set(RETURN_COOKIE, returnTo ?? '', { ...pkceCookieOptions(request), ...(returnTo ? {} : { maxAge: 0 }) });
    return res;
  } catch (error) {
    reportRouteError('[videos/youtube] start error:', error);
    return back(request, fallback);
  }
}
