/**
 * The one local session check both the middleware and the API gates run
 * (speed round 2). Pure over its inputs so it is node-testable: a cookie
 * reader, the project URL, the secret (null = off) and the clock. Null means
 * "not verified here — take the network path", never "refused".
 */

import { readAccessTokenFromCookies } from './session-cookie';
import { authIssuer, verifyAccessToken, type VerifiedClaims } from './jwt';

export interface LocalSessionInput {
  getCookie: (name: string) => string | undefined;
  supabaseUrl: string;
  secret: string | null;
  /** Seconds since the epoch; defaults to now. */
  now?: number;
}

export async function verifySessionLocally(input: LocalSessionInput): Promise<VerifiedClaims | null> {
  if (!input.secret || !input.supabaseUrl) return null;
  const token = await readAccessTokenFromCookies(input.getCookie, input.supabaseUrl);
  if (!token) return null;
  return verifyAccessToken(token, { secret: input.secret, issuer: authIssuer(input.supabaseUrl), now: input.now });
}
