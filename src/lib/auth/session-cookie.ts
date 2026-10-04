/**
 * Read the access token out of @supabase/ssr's session cookie without a
 * Supabase client (speed round 2). The cookie is `sb-<project-ref>-auth-token`,
 * split into `.0`, `.1`… chunks when long, holding `base64-<base64url(JSON)>`
 * (or, for sessions written before that encoding, the JSON itself). The JSON
 * is the session: `{ access_token, refresh_token, expires_at, user }`. Only
 * `access_token` is read here — the refresh token never leaves the cookie jar
 * on this path, and the JWT inside is verified before anything trusts it
 * (jwt.ts). Edge-safe: the two helpers are @supabase/ssr's own exports.
 */

import { combineChunks, stringFromBase64URL } from '@supabase/ssr';

/** The cookie key @supabase/ssr uses for this project. */
export function supabaseStorageKey(supabaseUrl: string): string | null {
  try {
    const host = new URL(supabaseUrl).hostname;
    const ref = host.split('.')[0];
    return ref ? `sb-${ref}-auth-token` : null;
  } catch {
    return null;
  }
}

export async function readAccessTokenFromCookies(
  getCookie: (name: string) => string | undefined,
  supabaseUrl: string
): Promise<string | null> {
  const key = supabaseStorageKey(supabaseUrl);
  if (!key) return null;
  let raw: string | null | undefined;
  try {
    raw = await combineChunks(key, name => getCookie(name) ?? null);
  } catch {
    return null;
  }
  if (!raw) return null;
  let json: string = raw;
  if (raw.startsWith('base64-')) {
    try {
      json = stringFromBase64URL(raw.slice('base64-'.length));
    } catch {
      return null;
    }
  }
  try {
    const parsed = JSON.parse(json) as { access_token?: unknown } | null;
    const token = parsed && typeof parsed === 'object' ? parsed.access_token : null;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}
