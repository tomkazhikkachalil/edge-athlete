import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Signed draft-preview tokens for /org/[slug]/preview/[token] (cleanup
 * round). The media-token recipe with two deliberate differences: the
 * payload names a SITE (not a storage object), and it EXPIRES — a
 * preview link is a short-lived capability handed to a verified org
 * manager by the console API, and the token IS the authorization (the
 * public segment stays session-free). Secret reuse: MEDIA_PROXY_SECRET
 * (+_PREVIOUS during rotation) — one secret family for all same-origin
 * capability URLs, read lazily so placeholder-env builds never throw.
 */

export interface PreviewTokenPayload {
  /** Secret/format version. */
  v: number;
  /** Site id the preview is scoped to. */
  s: string;
  /** Expiry, epoch seconds. */
  e: number;
}

const CURRENT_VERSION = 1;
export const PREVIEW_TOKEN_TTL_SECONDS = 30 * 60;

function secrets(): { current: string | null; previous: string | null } {
  return {
    current: process.env.MEDIA_PROXY_SECRET || null,
    previous: process.env.MEDIA_PROXY_SECRET_PREVIOUS || null,
  };
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function mac(payloadB64: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(`preview:${payloadB64}`).digest();
}

/** Sign a preview token for a site. Throws if no secret is configured. */
export function signPreviewToken(siteId: string, nowMs = Date.now()): string {
  const { current } = secrets();
  if (!current) throw new Error('MEDIA_PROXY_SECRET is not configured');
  const payload: PreviewTokenPayload = {
    v: CURRENT_VERSION,
    s: siteId,
    e: Math.floor(nowMs / 1000) + PREVIEW_TOKEN_TTL_SECONDS,
  };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)));
  return `${payloadB64}.${b64url(mac(payloadB64, current))}`;
}

/** Verify a token: signature (constant-time, rotation-aware), format,
 *  and expiry. Returns the site id or null — never throws. */
export function verifyPreviewToken(
  token: string | null | undefined,
  nowMs = Date.now()
): string | null {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  let sig: Buffer;
  try {
    sig = Buffer.from(sigB64, 'base64url');
  } catch {
    return null;
  }
  if (sig.length !== 32) return null;

  const { current, previous } = secrets();
  const ok = [current, previous].some(secret => {
    if (!secret) return false;
    const expected = mac(payloadB64, secret);
    return expected.length === sig.length && timingSafeEqual(expected, sig);
  });
  if (!ok) return null;

  let payload: PreviewTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (payload.v !== CURRENT_VERSION || typeof payload.s !== 'string') return null;
  if (typeof payload.e !== 'number' || payload.e * 1000 < nowMs) return null;
  return payload.s;
}
