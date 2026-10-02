import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { reportRouteError } from '@/lib/observability/report';
import { isConnectionProvider } from '@/lib/activities/connections';
import { disconnect } from '@/lib/activities/connections-server';

/**
 * DELETE /api/connections/[provider] — disconnect one watch or app (mig 247).
 *
 * The caller's OWN connection. The row is deleted — new workouts stop
 * arriving; the activities already delivered stay (they are the athlete's,
 * removed like any other activity). Deliberately NOT behind the moderation
 * write gate: withdrawing a standing delivery is always allowed, whatever
 * the account's state (the ticket routes' precedent).
 *
 * 200 { removed } — `removed: false` when there was nothing to remove (a
 * second tap, another device): the same success. 400 for a word that is not
 * a provider.
 */
type Ctx = { params: Promise<{ provider: string }> };

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'connection-write', { userId: user.id });
    if (limited) return limited;

    const { provider } = await params;
    if (!isConnectionProvider(provider)) {
      return NextResponse.json({ error: 'Unknown app' }, { status: 400 });
    }
    const outcome = await disconnect(getSupabaseAdmin(), user.id, provider);
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ removed: outcome.removed });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[connections] disconnect error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
