import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { reportRouteError } from '@/lib/observability/report';
import { projectConnections } from '@/lib/activities/connections';
import { isSupervisedProfile, readConnections } from '@/lib/activities/connections-server';
import { secretBoxReady } from '@/lib/crypto/secret-box-server';

/**
 * GET /api/connections — the caller's connected watches and apps (mig 247).
 *
 * The caller's OWN connections only (self; a guardian connecting for an
 * athlete is not part of this round). One entry per provider, in list order,
 * through the projection in activities/connections.ts — a response never
 * carries a provider secret or the upload link's token hash.
 *
 *   supported  247 has run here (false → the screen says "not available yet")
 *   ready      the server holds the key that seals provider tokens — an
 *              OAuth connection cannot be made without it (fail closed)
 *   supervised a supervised account cannot connect; the screen says why
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const admin = getSupabaseAdmin();
    const [read, supervised] = await Promise.all([readConnections(admin, user.id), isSupervisedProfile(admin, user.id)]);
    return NextResponse.json(
      {
        supported: read.supported,
        ready: secretBoxReady(),
        supervised,
        connections: projectConnections(read.rows),
      },
      { headers: NO_STORE }
    );
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[connections] list error:', error);
    return NextResponse.json({ error: 'Could not load your connected apps' }, { status: 500, headers: NO_STORE });
  }
}
