import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { todayUTC } from '@/lib/views/client';
import { reportRouteError } from '@/lib/observability/report';

/**
 * POST /api/seen — the seen mark (migration 267): the signed-in account
 * opened the app today. ONE row write per account per UTC day
 * (`bump_profile_seen`, idempotent); the `ea-seen` cookie dedups tabs so a
 * second call in the day costs no query. Answers 204 whatever happened — a
 * beacon never surfaces (the 252 posture). The mark is the AUTHENTICATED
 * account, never a profile acted for. Nothing about what was done is kept.
 */
const COOKIE = 'ea-seen';
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export async function POST(request: NextRequest) {
  const day = todayUTC();
  const res = new NextResponse(null, { status: 204, headers: NO_STORE });
  try {
    const { user, error } = await getServerAuth(request);
    if (error || !user) return res;
    if (request.cookies.get(COOKIE)?.value === day) return res;
    const limited = await enforceRateLimit(request, 'seen', { userId: user.id });
    if (limited) return res;

    const admin = getSupabaseAdmin();
    const timeout = new Promise<{ error: { code?: string; message?: string } | null }>(resolve =>
      setTimeout(() => resolve({ error: { code: 'TIMEOUT', message: 'bump_profile_seen took too long' } }), 1500)
    );
    const result = await Promise.race([admin.rpc('bump_profile_seen', { p_profile: user.id, p_day: day }), timeout]);
    if (result.error && result.error.code !== '42883' && result.error.code !== 'PGRST202') {
      reportRouteError('[POST /api/seen] bump failed (non-fatal):', result.error.message);
      return res;
    }
    res.cookies.set(COOKIE, day, { httpOnly: true, sameSite: 'lax', secure: request.nextUrl.protocol === 'https:', path: '/', maxAge: 86400 });
    return res;
  } catch (err) {
    reportRouteError('[POST /api/seen]', err);
    return res;
  }
}
