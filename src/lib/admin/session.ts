/**
 * The admin console's own session (flow changes program, item 2 — Oct 19
 * 2026). Pure, ZERO imports: the cookie's name and options, the claims
 * shape, the lifetime, and the one rule for where a login may send you.
 *
 * Tom's decision: the console is a SEPARATE door — its own sign-in page,
 * its own cookie; the app session never grants admin. The account is still
 * a Supabase user on the admin list (so every action keeps an actor id),
 * but the password is checked HERE and the result is THIS cookie, never an
 * app session.
 */

export const ADMIN_COOKIE = 'ea_admin';
export const ADMIN_LOGIN_PATH = '/admin/login';
export const ADMIN_HOME_PATH = '/admin';
/** A console session lasts this long from sign-in; there is no sliding renewal. */
export const ADMIN_SESSION_TTL_S = 12 * 60 * 60;

export type AdminRole = 'owner' | 'moderator';

export interface AdminClaims {
  /** The Supabase user id — the actor every admin write records. */
  sub: string;
  email: string;
  role: AdminRole;
  iat: number;
  exp: number;
}

export function adminCookieOptions(secure: boolean): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'strict';
  path: '/';
  maxAge: number;
} {
  return { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: ADMIN_SESSION_TTL_S };
}

/** The claims are well-formed and unexpired at `nowS`. */
export function validAdminClaims(raw: unknown, nowS: number): raw is AdminClaims {
  if (!raw || typeof raw !== 'object') return false;
  const c = raw as Record<string, unknown>;
  return (
    typeof c.sub === 'string' &&
    /^[0-9a-f-]{36}$/i.test(c.sub) &&
    typeof c.email === 'string' &&
    c.email.includes('@') &&
    (c.role === 'owner' || c.role === 'moderator') &&
    typeof c.iat === 'number' &&
    typeof c.exp === 'number' &&
    c.exp > nowS &&
    c.exp - c.iat <= ADMIN_SESSION_TTL_S
  );
}

/**
 * Where a login may land: a path INSIDE the console (`/admin…`), never a
 * scheme, a host or the app — an open redirect through `?next=` is the
 * classic login-page hole. Anything else → the console home.
 */
export function safeAdminNext(next: string | null | undefined): string {
  if (typeof next !== 'string') return ADMIN_HOME_PATH;
  if (!next.startsWith('/admin')) return ADMIN_HOME_PATH;
  if (next.startsWith('//') || /[\\\r\n]/.test(next)) return ADMIN_HOME_PATH;
  if (next === ADMIN_LOGIN_PATH || next.startsWith(`${ADMIN_LOGIN_PATH}?`)) return ADMIN_HOME_PATH;
  return next;
}
