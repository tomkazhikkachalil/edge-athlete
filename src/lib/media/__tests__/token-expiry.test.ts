import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { privateTokenExpiry, signMediaToken, verifyMediaToken, PRIVATE_URL_MIN_LIFE_SECONDS } from '../token';
import { toProxyUrl } from '../proxy-url';
import { createHmac } from 'node:crypto';

const SB = 'https://abc.supabase.co/storage/v1/object/public';

beforeEach(() => {
  process.env.MEDIA_PROXY_SECRET = 'test-secret-for-media-tokens';
});
afterEach(() => {
  delete process.env.MEDIA_PROXY_SECRET;
});

describe('expiring private tokens (speed round 2)', () => {
  it('privateTokenExpiry is the end of the NEXT UTC day — the same all day, 24–48 h of life', () => {
    const day = 86400;
    const midnight = 1_800_000_000 - (1_800_000_000 % day);
    expect(privateTokenExpiry(midnight)).toBe(midnight + 2 * day);
    expect(privateTokenExpiry(midnight + 1)).toBe(midnight + 2 * day);
    expect(privateTokenExpiry(midnight + day - 1)).toBe(midnight + 2 * day);
    expect(privateTokenExpiry(midnight + day)).toBe(midnight + 3 * day);
    expect(privateTokenExpiry(midnight + day - 1) - (midnight + day - 1)).toBeGreaterThanOrEqual(PRIVATE_URL_MIN_LIFE_SECONDS);
  });

  it('a token with exp verifies until exp and is a forgery after', () => {
    const now = 1_800_000_000;
    const token = signMediaToken({ b: 'uploads', k: 'posts/u/x.jpg', t: 'post', id: 'p1', exp: now + 10 });
    expect(verifyMediaToken(token, now)?.exp).toBe(now + 10);
    expect(verifyMediaToken(token, now + 9)).not.toBeNull();
    expect(verifyMediaToken(token, now + 10)).toBeNull();
    expect(verifyMediaToken(token, now + 11)).toBeNull();
  });

  it('a token without exp never expires (public media keeps a stable URL)', () => {
    const token = signMediaToken({ b: 'uploads', k: 'posts/u/x.jpg', t: 'post', id: 'p1' });
    expect(verifyMediaToken(token, 10 ** 10)).not.toBeNull();
    expect(verifyMediaToken(token)?.exp).toBeUndefined();
  });

  it('a non-numeric exp smuggled into a payload is refused', () => {
    const payload = Buffer.from(JSON.stringify({ v: 1, b: 'uploads', k: 'k', t: 'post', id: 'p', exp: 'never' })).toString('base64url');
    // Sign that exact payload the way the signer would.
    const sig = createHmac('sha256', process.env.MEDIA_PROXY_SECRET!).update(payload).digest().toString('base64url');
    expect(verifyMediaToken(`${payload}.${sig}`)).toBeNull();
  });

  it('toProxyUrl mints an expiring URL only when told the media is private', () => {
    const url = `${SB}/uploads/posts/u1/a.jpg`;
    const read = (proxy: string | null) => JSON.parse(Buffer.from(proxy!.slice('/api/media/'.length).split('.')[0], 'base64url').toString());
    expect(read(toProxyUrl(url, { type: 'post', id: 'p' })).exp).toBeUndefined();
    expect(read(toProxyUrl(url, { type: 'post', id: 'p' }, { visibility: 'public' })).exp).toBeUndefined();
    const priv = read(toProxyUrl(url, { type: 'post', id: 'p' }, { visibility: 'private' }));
    expect(priv.exp).toBe(privateTokenExpiry());
    // Stable within the day: two mints agree, so the browser cache keeps working.
    expect(toProxyUrl(url, { type: 'post', id: 'p' }, { visibility: 'private' })).toBe(
      toProxyUrl(url, { type: 'post', id: 'p' }, { visibility: 'private' })
    );
  });
});
