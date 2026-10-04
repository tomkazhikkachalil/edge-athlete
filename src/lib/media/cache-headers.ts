/**
 * The media proxy's Cache-Control (speed round 2, Oct 4 2026). Pure — pinned.
 *
 * PUBLIC media (anyone, signed out too, may view): one copy for everyone, so
 * the CDN keeps it a day and the browser an hour; `stale-while-revalidate`
 * lets a stale copy paint while the edge refetches. NO `Vary: Cookie` — the
 * old header made every signed-in cookie jar its own cache key, so the CDN
 * almost never hit for the people who actually use the app.
 *
 * PRIVATE media (followers-only, a private account, a message): the
 * Instagram / Facebook model — the URL is an unguessable, EXPIRING capability
 * (token.ts `exp`), the viewer's own browser caches the bytes for the URL's
 * life, and a shared cache never stores them (`private`). A copied URL dies
 * with its token; a person who loses access keeps only what their device
 * already holds, for at most the token's remaining life. `no-transform`
 * keeps intermediaries from re-encoding what the editor may re-open.
 */

export const PUBLIC_BROWSER_MAX_AGE = 3600;
export const PUBLIC_CDN_MAX_AGE = 86400;
export const PUBLIC_SWR = 604800;
export const PRIVATE_MAX_AGE_CAP = 86400;
/** A private URL without an expiring token (an older mint) still caches on the device, briefly. */
export const PRIVATE_NO_EXP_MAX_AGE = 3600;

export interface CachePolicyInput {
  isPublic: boolean;
  /** The token's expiry in seconds since the epoch; absent for a non-expiring token. */
  tokenExp?: number | null;
  /** Seconds since the epoch; defaults to now. */
  now?: number;
}

export function mediaCacheHeaders(input: CachePolicyInput): Record<string, string> {
  if (input.isPublic) {
    return {
      'cache-control': `public, max-age=${PUBLIC_BROWSER_MAX_AGE}, s-maxage=${PUBLIC_CDN_MAX_AGE}, stale-while-revalidate=${PUBLIC_SWR}`,
    };
  }
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const remaining = typeof input.tokenExp === 'number' ? input.tokenExp - now : null;
  const maxAge =
    remaining === null ? PRIVATE_NO_EXP_MAX_AGE : Math.max(0, Math.min(PRIVATE_MAX_AGE_CAP, remaining));
  return { 'cache-control': `private, max-age=${maxAge}, no-transform` };
}
