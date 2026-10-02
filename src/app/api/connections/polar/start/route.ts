import { NextRequest, NextResponse } from 'next/server';
import { activeWriterRefusal, getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { reportRouteError } from '@/lib/observability/report';
import { isSupervisedProfile } from '@/lib/activities/connections-server';
import { signOAuthState } from '@/lib/activities/oauth-state-server';
import { polarAuthorizeUrl, polarConfig } from '@/lib/activities/providers/polar-server';
import { secretBoxReady } from '@/lib/crypto/secret-box-server';

/**
 * GET /api/connections/polar/start — send the athlete to Polar to give their
 * consent (fix round part 3, PR 4). A NAVIGATION, not a fetch (the Connect
 * button is a link), so every refusal is a redirect back to Settings →
 * Connected apps with the reason — never a JSON body in the address bar.
 *
 * Refused: signed out; Polar not configured or no sealing key (the card
 * says "Coming soon" then, so this is a typed URL); a supervised account; an
 * account the moderation write gate holds (a connection is a standing way
 * to create content — both Polar routes are on THE write-gate list).
 *
 * The `state` is signed and names this account (oauth-state-server.ts): the
 * callback only completes in the session that started here.
 */
const back = (request: NextRequest, error: string) =>
  NextResponse.redirect(new URL(`/settings?tab=connections&connect_error=${error}`, request.url), 302);

export async function GET(request: NextRequest) {
  try {
    const { user } = await getServerAuth(request);
    if (!user) return NextResponse.redirect(new URL('/?signin=1', request.url), 302);

    const cfg = polarConfig();
    if (!cfg || !secretBoxReady()) return back(request, 'unavailable');

    const limited = await enforceRateLimit(request, 'connection-write', { userId: user.id });
    if (limited) return back(request, 'busy');
    if (await isSupervisedProfile(getSupabaseAdmin(), user.id)) return back(request, 'supervised');
    if (await activeWriterRefusal(user.id)) return back(request, 'limited');

    const origin = new URL(request.url).origin;
    const url = polarAuthorizeUrl(cfg, {
      state: signOAuthState({ userId: user.id, provider: 'polar' }),
      redirectUri: `${origin}/api/connections/polar/callback`,
    });
    return NextResponse.redirect(url, 302);
  } catch (error) {
    reportRouteError('[connections/polar] start error:', error);
    return back(request, 'failed');
  }
}
