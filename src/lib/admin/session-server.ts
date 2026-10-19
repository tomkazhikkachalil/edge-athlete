/**
 * The admin cookie's mint and read (flow changes program, item 2 — Oct 19
 * 2026). jose HS256 on ADMIN_SESSION_SECRET (server-only; unset = the
 * console's own door is OFF — the login answers 503 by name, nothing else
 * changes). This module imports NOTHING from auth-server (auth-server
 * imports it), so the role lookup lives beside the sign-in, in
 * `sign-in-server.ts`.
 */
import { SignJWT, jwtVerify } from 'jose';
import type { NextRequest } from 'next/server';
import { parseCookieHeader } from '@/lib/cookies';
import { ADMIN_COOKIE, ADMIN_SESSION_TTL_S, validAdminClaims, type AdminClaims, type AdminRole } from './session';

const ISSUER = 'edge-athlete-admin';

/** The secret; null = the console's own sign-in is not configured. */
export function adminSecret(env: Record<string, string | undefined> = process.env): string | null {
  const v = env.ADMIN_SESSION_SECRET;
  return typeof v === 'string' && v.length >= 32 ? v : null;
}

export async function mintAdminToken(input: { sub: string; email: string; role: AdminRole }, secret: string, nowS = Math.floor(Date.now() / 1000)): Promise<string> {
  return new SignJWT({ email: input.email, role: input.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(input.sub)
    .setIssuer(ISSUER)
    .setIssuedAt(nowS)
    .setExpirationTime(nowS + ADMIN_SESSION_TTL_S)
    .sign(new TextEncoder().encode(secret));
}

/** Null for anything the secret cannot vouch for: tampered, expired, the wrong issuer, a foreign alg. Never throws. */
export async function readAdminToken(token: string | null | undefined, secret: string, nowS = Math.floor(Date.now() / 1000)): Promise<AdminClaims | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
      issuer: ISSUER,
      currentDate: new Date(nowS * 1000),
    });
    const claims = { sub: payload.sub, email: payload.email, role: payload.role, iat: payload.iat, exp: payload.exp };
    return validAdminClaims(claims, nowS) ? claims : null;
  } catch {
    return null;
  }
}

const memo = new WeakMap<NextRequest, Promise<AdminClaims | null>>();

/** The admin cookie on an API request, verified — memoized per request. Null without a secret or a cookie. */
export function readAdminSession(request: NextRequest): Promise<AdminClaims | null> {
  let pending = memo.get(request);
  if (!pending) {
    pending = (async () => {
      const secret = adminSecret();
      if (!secret) return null;
      const cookies = parseCookieHeader(request.headers.get('cookie') ?? '');
      return readAdminToken(cookies[ADMIN_COOKIE], secret);
    })();
    memo.set(request, pending);
  }
  return pending;
}
