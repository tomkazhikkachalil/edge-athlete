import { NextRequest, NextResponse } from 'next/server';
import { activeWriterRefusal, getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { reportRouteError } from '@/lib/observability/report';
import { connectProvider, isSupervisedProfile, readProviderConnection } from '@/lib/activities/connections-server';
import { verifyOAuthState } from '@/lib/activities/oauth-state-server';
import { polarConfig, polarExchangeCode, polarRegisterUser } from '@/lib/activities/providers/polar-server';
import { syncPolarConnection } from '@/lib/activities/providers/polar-sync-server';

/**
 * GET /api/connections/polar/callback — Polar sends the athlete back here
 * with a code (fix round part 3, PR 4). Also a navigation: it always ends in
 * a redirect to Settings → Connected apps, `connected=polar` or
 * `connect_error=<reason>`.
 *
 * In order: the session; the SIGNED state (made for this account, ten
 * minutes — a code can never be attached to someone else's session); the
 * supervised and moderation refusals again (the state of the account may
 * have changed while they were at Polar); code → token; register the user
 * with AccessLink (needed before any read); the token sealed into the
 * connection row (connections-server.ts); then the FIRST SYNC — the recent
 * exercises Polar still holds (30 days), a bounded handful now and the rest
 * through the daily run — so the athlete comes back to a Vitals that already
 * has their week in it.
 */
export const maxDuration = 60;

const FIRST_SYNC = 10;

const back = (request: NextRequest, query: string) =>
  NextResponse.redirect(new URL(`/settings?tab=connections&${query}`, request.url), 302);

export async function GET(request: NextRequest) {
  try {
    const { user } = await getServerAuth(request);
    if (!user) return NextResponse.redirect(new URL('/?signin=1', request.url), 302);

    const cfg = polarConfig();
    if (!cfg) return back(request, 'connect_error=unavailable');

    const params = new URL(request.url).searchParams;
    // The athlete said no at Polar (or Polar reported an error): nothing to do.
    if (params.get('error')) return back(request, 'connect_error=denied');
    const code = params.get('code');
    if (!code || code.length > 512) return back(request, 'connect_error=failed');
    if (!verifyOAuthState(params.get('state'), { userId: user.id, provider: 'polar' })) {
      return back(request, 'connect_error=expired');
    }

    const admin = getSupabaseAdmin();
    if (await isSupervisedProfile(admin, user.id)) return back(request, 'connect_error=supervised');
    if (await activeWriterRefusal(user.id)) return back(request, 'connect_error=limited');

    const origin = new URL(request.url).origin;
    const token = await polarExchangeCode(cfg, code, `${origin}/api/connections/polar/callback`);
    if (!token.ok) return back(request, 'connect_error=failed');
    if (!(await polarRegisterUser(cfg, token.accessToken, user.id))) return back(request, 'connect_error=failed');

    const connected = await connectProvider(admin, user.id, 'polar', {
      providerUserId: token.userId,
      secret: { accessToken: token.accessToken },
    });
    if (!connected.ok) return back(request, `connect_error=${connected.status === 409 ? 'taken' : connected.status === 500 ? 'failed' : 'unavailable'}`);

    // The first sync is a courtesy: if it fails the connection still stands
    // and the daily run picks it up.
    try {
      const conn = await readProviderConnection(admin, user.id, 'polar');
      if (conn) await syncPolarConnection(admin, cfg, conn, FIRST_SYNC);
    } catch (e) {
      console.error('[connections/polar] first sync failed:', e instanceof Error ? e.message : e);
    }
    return back(request, 'connected=polar');
  } catch (error) {
    reportRouteError('[connections/polar] callback error:', error);
    return back(request, 'connect_error=failed');
  }
}
