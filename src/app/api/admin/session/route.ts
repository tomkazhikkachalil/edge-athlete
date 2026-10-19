import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { emailString, parseBody } from '@/lib/validation';
import { enforceRateLimit } from '@/lib/rate-limit';
import { adminSecret, readAdminSession } from '@/lib/admin/session-server';
import { signInAdmin } from '@/lib/admin/sign-in-server';
import { ADMIN_COOKIE, adminCookieOptions } from '@/lib/admin/session';
import { reportRouteError } from '@/lib/observability/report';

/**
 * /api/admin/session — the console's own door (flow changes item 2).
 * POST { email, password } → the admin cookie (HttpOnly, Strict, 12 h);
 * two buckets (per IP, per IP + email) with the attempts copy; a refusal is
 * one sentence whatever was wrong; 503 by name while ADMIN_SESSION_SECRET is
 * unset. GET answers who holds the cookie. DELETE clears it. PUBLIC by
 * design (a login page has no session yet) — listed in the authz audit.
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;
const INVALID = 'That email and password did not open the console.';

const Body = z.object({ email: emailString, password: z.string().min(1).max(256) });

export async function POST(request: NextRequest) {
  try {
    const secret = adminSecret();
    if (!secret) return NextResponse.json({ error: 'Admin sign-in is not configured on this deployment.' }, { status: 503, headers: NO_STORE });
    const parsed = await parseBody(request, Body);
    if (!parsed.success) return parsed.response;
    const ipLimited = await enforceRateLimit(request, 'admin-login-ip');
    if (ipLimited) return ipLimited;
    const limited = await enforceRateLimit(request, 'admin-login', { extraKey: parsed.data.email });
    if (limited) return limited;

    const outcome = await signInAdmin(parsed.data.email, parsed.data.password, secret);
    if (!outcome.ok) return NextResponse.json({ error: INVALID }, { status: 401, headers: NO_STORE });
    const res = NextResponse.json({ role: outcome.role, email: outcome.email }, { headers: NO_STORE });
    res.cookies.set(ADMIN_COOKIE, outcome.token, adminCookieOptions(request.nextUrl.protocol === 'https:'));
    return res;
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[POST /api/admin/session]', error);
    return NextResponse.json({ error: 'Could not sign in right now.' }, { status: 500, headers: NO_STORE });
  }
}

export async function GET(request: NextRequest) {
  const claims = await readAdminSession(request);
  if (!claims) return NextResponse.json({ error: 'Admin sign-in required' }, { status: 401, headers: NO_STORE });
  return NextResponse.json({ id: claims.sub, email: claims.email, role: claims.role, expiresAt: claims.exp }, { headers: NO_STORE });
}

export async function DELETE(request: NextRequest) {
  const res = NextResponse.json({ ok: true }, { headers: NO_STORE });
  res.cookies.set(ADMIN_COOKIE, '', { ...adminCookieOptions(request.nextUrl.protocol === 'https:'), maxAge: 0 });
  return res;
}
