/**
 * Local verification of a Supabase access token (speed round 2, Oct 4 2026).
 *
 * Every API call and every page load used to ask Supabase Auth over the
 * network "is this session valid?" — 100–300 ms each, before the route's own
 * work. The access token is a JWT signed with the project's secret; verifying
 * it here costs microseconds. Tom's decision: verify locally, with the
 * access-token lifetime lowered to 10 minutes in the dashboard so a suspended
 * account loses READ access within that window (writes are refused at once —
 * the write gate keeps the network check, see auth-server.ts `fresh`).
 *
 * Rules, each pinned in __tests__/jwt.test.ts:
 *   - HS256 only (the project's legacy signing mode); `alg: none` or any
 *     asymmetric alg under this secret is refused — jose enforces the list.
 *   - `iss` must be this project's Auth (`${SUPABASE_URL}/auth/v1`), `aud`
 *     must be `authenticated`, `sub` must be a UUID.
 *   - A token within MIN_REMAINING_SECONDS of expiry is NOT accepted: the
 *     caller falls through to the network path, which is where @supabase/ssr
 *     refreshes the session and rewrites the cookies. Mirrors auth-js's
 *     EXPIRY_MARGIN so refresh frequency is unchanged.
 *   - Never throws; null means "not verified here" — the caller's network
 *     path is the authority. A failed local verify is NEVER a 401 by itself.
 *
 * `getClaims()` is no help: on an HS256 project auth-js falls back to the same
 * network `getUser`. When the project moves to asymmetric signing keys this
 * file is the one place that changes.
 */

import { jwtVerify, type JWTPayload } from 'jose';
import type { User } from '@supabase/supabase-js';

export const MIN_REMAINING_SECONDS = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VerifiedClaims {
  sub: string;
  email: string | null;
  role: string;
  aud: string;
  exp: number;
  iat: number | null;
  session_id: string | null;
  is_anonymous: boolean;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
}

/** The server-only secret; null = local verification is off (today's behaviour). */
export function jwtSecret(env: Record<string, string | undefined> = process.env): string | null {
  const value = env.SUPABASE_JWT_SECRET;
  return typeof value === 'string' && value.length >= 16 ? value : null;
}

/** The issuer the token must carry, from the project URL. */
export function authIssuer(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
}

export interface VerifyOptions {
  secret: string;
  issuer: string;
  /** Seconds since the epoch; defaults to now. */
  now?: number;
  minRemainingSeconds?: number;
}

export async function verifyAccessToken(token: string, opts: VerifyOptions): Promise<VerifiedClaims | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 8192) return null;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const minRemaining = opts.minRemainingSeconds ?? MIN_REMAINING_SECONDS;
  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, new TextEncoder().encode(opts.secret), {
      algorithms: ['HS256'],
      issuer: opts.issuer,
      audience: 'authenticated',
      currentDate: new Date(now * 1000),
    });
    payload = result.payload;
  } catch {
    return null;
  }
  if (typeof payload.sub !== 'string' || !UUID_RE.test(payload.sub)) return null;
  if (typeof payload.exp !== 'number' || payload.exp - now < minRemaining) return null;
  const email = typeof payload.email === 'string' ? payload.email : null;
  const role = typeof payload.role === 'string' ? payload.role : 'authenticated';
  return {
    sub: payload.sub,
    email,
    role,
    aud: 'authenticated',
    exp: payload.exp,
    iat: typeof payload.iat === 'number' ? payload.iat : null,
    session_id: typeof payload.session_id === 'string' ? payload.session_id : null,
    is_anonymous: payload.is_anonymous === true,
    app_metadata: isRecord(payload.app_metadata) ? payload.app_metadata : {},
    user_metadata: isRecord(payload.user_metadata) ? payload.user_metadata : {},
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The `User` the gates hand to routes, built from the token. Everything a
 * route reads in practice is here (`id`, `email`, the metadata the token
 * carries); the account's row fields the token does NOT carry (`created_at`,
 * `last_sign_in_at`, `identities`) are empty — a route that needs them asks
 * for the network user with `{ fresh: true }` (pinned by a source test).
 */
export function claimsToUser(claims: VerifiedClaims): User {
  return {
    id: claims.sub,
    aud: claims.aud,
    role: claims.role,
    email: claims.email ?? undefined,
    app_metadata: claims.app_metadata,
    user_metadata: claims.user_metadata,
    is_anonymous: claims.is_anonymous,
    created_at: '',
    identities: [],
  } as unknown as User;
}
