import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

// ── The OAuth `state` (fix round part 3, PR 4) — SERVER ONLY ────────────────
// The value Edge Athlete sends a provider with the athlete and gets back on
// the callback. It is what stops a stranger's authorization code being
// attached to someone else's session: the state is SIGNED and names the
// account and the provider it was made for, so a callback only succeeds in
// the session that started it, for ten minutes.
//
// The signing key is derived from CONNECTIONS_ENC_KEY (never the key
// itself). No key → signing throws and nothing verifies: a provider
// connection cannot be started without it (the secret box's rule).

const TTL_MS = 10 * 60_000;

function signingKey(): Buffer | null {
  const raw = process.env.CONNECTIONS_ENC_KEY?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) return null;
  return createHmac('sha256', key).update('edge-athlete:oauth-state:v1').digest();
}

const mac = (key: Buffer, payload: string) => createHmac('sha256', key).update(payload).digest();

export function signOAuthState(opts: { userId: string; provider: string; now?: number }): string {
  const key = signingKey();
  if (!key) throw new Error('CONNECTIONS_ENC_KEY is not configured');
  const payload = Buffer.from(
    JSON.stringify({ u: opts.userId, p: opts.provider, t: opts.now ?? Date.now(), n: randomBytes(9).toString('base64url') })
  ).toString('base64url');
  return `${payload}.${mac(key, payload).toString('base64url')}`;
}

export function verifyOAuthState(state: string | null | undefined, opts: { userId: string; provider: string; now?: number }): boolean {
  const key = signingKey();
  if (!key || typeof state !== 'string') return false;
  const [payload, sig, extra] = state.split('.');
  if (!payload || !sig || extra !== undefined) return false;
  const given = Buffer.from(sig, 'base64url');
  const expected = mac(key, payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { u?: unknown; p?: unknown; t?: unknown };
    const age = (opts.now ?? Date.now()) - Number(p.t);
    return p.u === opts.userId && p.p === opts.provider && Number.isFinite(age) && age >= -60_000 && age <= TTL_MS;
  } catch {
    return false;
  }
}
