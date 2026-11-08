import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readPageTimingsPayload } from '@/lib/observability/page-timings-rules';
import { reportRouteError } from '@/lib/observability/report';

/**
 * POST /api/page-timings — the real-user page-timings beacon (migration 305;
 * the performance program Phase 0.4, Nov 2026). A browser sends ONE batch per
 * page view (components/observability/PageTimingBeacon.tsx): the build, the
 * route with its ids masked, the timing metrics it measured (LCP, INP, CLS,
 * TTFB, FCP), a device class and the navigation type. The rows say nothing
 * about a person — no id, no IP, no user agent — only whether a session was
 * present, so a signed-out landing can be told from a signed-in open.
 * Answers 204 whatever happened (the beacon posture: a measurement never
 * surfaces as an error); the table missing (production before 305 ran) is
 * the same silent 204. An IP bucket (`page-timings`, 60 a minute) is the only
 * gate — anonymous visitors count too, so write-general is not spent here
 * (write-routes-limited.test.ts carries the reason).
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export async function POST(request: NextRequest) {
  const res = new NextResponse(null, { status: 204, headers: NO_STORE });
  try {
    const limited = await enforceRateLimit(request, 'page-timings');
    if (limited) return res;
    const body = await request.json().catch(() => null);
    const { user } = await getServerAuth(request);
    const rows = readPageTimingsPayload(body, !!user);
    if (!rows || rows.length === 0) return res;
    const { error } = await getSupabaseAdmin().from('page_timings').insert(rows);
    // 42P01 / PGRST205: the table is not here yet — the deploy may precede the migration.
    if (error && error.code !== '42P01' && error.code !== 'PGRST205') {
      reportRouteError('[POST /api/page-timings] insert failed (non-fatal):', error.message);
    }
    return res;
  } catch (err) {
    reportRouteError('[POST /api/page-timings]', err);
    return res;
  }
}
