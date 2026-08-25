import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Signed capability tokens for the media proxy (/api/media/[token]).
 *
 * A token names a storage object AND the entity whose visibility governs it —
 * but NEVER a visibility verdict. The proxy re-authorizes the live viewer
 * against the entity's CURRENT visibility on every request, so a post flipping
 * public→private is honored on the next load with no token change. The token's
 * only job is to be an unforgeable, stable pointer: you cannot mint a valid MAC
 * for an arbitrary {bucket,key}, so a viewer cannot forge access to someone
 * else's object or enumerate keys. The token grants nothing on its own.
 *
 * Stable per media (deterministic) → the same object always yields the same URL,
 * so the browser and CDN cache it. Non-expiring by design (authorization is the
 * proxy's job, not the token's). Secret rotation: bump `v` and set
 * MEDIA_PROXY_SECRET_PREVIOUS during the window.
 */

export type MediaEntityType =
  | 'post'
  | 'message'
  | 'group'
  | 'equipment'
  | 'vitals'
  | 'workout'
  | 'cover';

export interface MediaTokenPayload {
  /** Secret/format version. */
  v: number;
  /** Storage bucket. */
  b: string;
  /** Storage object key (path within the bucket). */
  k: string;
  /** Entity type whose visibility governs this object. */
  t: MediaEntityType;
  /** Governing entity id — a single indexed lookup at request time. */
  id: string;
}

const CURRENT_VERSION = 1;

/**
 * Lazily read the signing secret(s). Read inside functions, never at module
 * scope: the production build (and CI) runs with placeholder env, and a
 * module-scope throw would break `next build`. A missing secret makes signing
 * throw at call time and verification fail closed — the proxy surfaces that as
 * a clean 5xx/404, never a crash.
 */
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
  return createHmac('sha256', secret).update(payloadB64).digest();
}

/** Sign a payload into a `<payload>.<mac>` token. Throws if no secret is set. */
export function signMediaToken(input: Omit<MediaTokenPayload, 'v'>): string {
  const { current } = secrets();
  if (!current) throw new Error('MEDIA_PROXY_SECRET is not configured');
  const payload: MediaTokenPayload = { v: CURRENT_VERSION, ...input };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(mac(payloadB64, current));
  return `${payloadB64}.${sig}`;
}

/**
 * Verify a token and return its payload, or null if the signature is invalid,
 * the format is wrong, or no secret is configured. Constant-time comparison;
 * accepts the previous secret during a rotation window.
 */
export function verifyMediaToken(token: string | null | undefined): MediaTokenPayload | null {
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
  if (sig.length !== 32) return null; // sha256 digest length

  const { current, previous } = secrets();
  const ok = [current, previous].some(secret => {
    if (!secret) return false;
    const expected = mac(payloadB64, secret);
    return expected.length === sig.length && timingSafeEqual(expected, sig);
  });
  if (!ok) return null;

  let payload: MediaTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (
    !payload ||
    typeof payload.b !== 'string' ||
    typeof payload.k !== 'string' ||
    typeof payload.t !== 'string' ||
    typeof payload.id !== 'string'
  ) {
    return null;
  }
  return payload;
}
