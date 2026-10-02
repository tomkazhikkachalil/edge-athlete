import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// ── The secret box (connections, mig 247) — SERVER ONLY ─────────────────────
// A provider's OAuth tokens are the athlete's standing consent; the database
// must never hold a usable one. They are sealed HERE with AES-256-GCM under a
// key that lives only in the server's environment, so a database dump, a
// backup or a stray select yields ciphertext.
//
//   CONNECTIONS_ENC_KEY            32 random bytes, base64 (or base64url)
//   CONNECTIONS_ENC_KEY_PREVIOUS   the last key, during a rotation window
//                                  (the MEDIA_PROXY_SECRET pattern): new
//                                  boxes are sealed with the current key,
//                                  either key opens.
//
// FAIL CLOSED: no key (or a key that is not 32 bytes) → seal THROWS and open
// answers null. A connection is refused rather than stored in the clear.
// The key is read inside the functions, never at module scope — the build
// and CI run without it.
//
// Box format (one string, safe in a text column):
//   v1.<iv b64url, 12 bytes>.<tag b64url, 16 bytes>.<ciphertext b64url>
// The `context` (which row and column the box belongs to) is bound as GCM
// additional data: a box copied onto another athlete's row does not open.

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function decodeKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  // Node's base64 decoder reads the URL-safe alphabet too, and never throws.
  const key = Buffer.from(raw.trim(), 'base64');
  return key.length === 32 ? key : null;
}

function keys(): { current: Buffer | null; previous: Buffer | null } {
  return {
    current: decodeKey(process.env.CONNECTIONS_ENC_KEY),
    previous: decodeKey(process.env.CONNECTIONS_ENC_KEY_PREVIOUS),
  };
}

/** Whether a usable key is configured — what a connect route asks first. */
export function secretBoxReady(): boolean {
  return keys().current !== null;
}

/** Seal a secret. Throws when no key is configured (fail closed). */
export function sealSecret(plaintext: string, context: string): string {
  const { current } = keys();
  if (!current) throw new Error('CONNECTIONS_ENC_KEY is not configured');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', current, iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

function openWith(key: Buffer, parts: string[], context: string): string | null {
  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    // A wrong key, a wrong context or a tampered box: GCM refuses all three alike.
    return null;
  }
}

/** Open a box. Null for anything that does not open — never a throw, never a partial value. */
export function openSecret(box: string | null | undefined, context: string): string | null {
  if (typeof box !== 'string') return null;
  const parts = box.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const { current, previous } = keys();
  for (const key of [current, previous]) {
    if (!key) continue;
    const opened = openWith(key, parts, context);
    if (opened !== null) return opened;
  }
  return null;
}

/** True when the box opens only with the PREVIOUS key — the caller re-seals it on its next write. */
export function needsReseal(box: string, context: string): boolean {
  const parts = box.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return false;
  const { current, previous } = keys();
  if (current && openWith(current, parts, context) !== null) return false;
  return !!previous && openWith(previous, parts, context) !== null;
}
