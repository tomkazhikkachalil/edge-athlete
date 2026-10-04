import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { toProxyUrl, isProtectedBucket } from '../proxy-url';
import { verifyMediaToken } from '../token';

const BASE = 'https://proj.supabase.co/storage/v1/object/public';

describe('toProxyUrl', () => {
  beforeEach(() => { process.env.MEDIA_PROXY_SECRET = 'test-secret-bbbbbbbbbbbbbbbbbbbbbbbb'; });
  afterEach(() => { delete process.env.MEDIA_PROXY_SECRET; });

  it('rewrites an uploads URL to a verifiable proxy path', () => {
    const out = toProxyUrl(`${BASE}/uploads/posts/u1/a.jpg`, { type: 'post', id: 'p1' });
    expect(out).toMatch(/^\/api\/media\//);
    const token = out!.slice('/api/media/'.length);
    expect(verifyMediaToken(token)).toEqual({ v: 1, b: 'uploads', k: 'posts/u1/a.jpg', t: 'post', id: 'p1' });
  });

  it('leaves avatars and badges (non-protected buckets) unchanged', () => {
    const avatar = `${BASE}/avatars/avatar-u1-123.png`;
    expect(toProxyUrl(avatar, { type: 'post', id: 'p1' })).toBe(avatar);
    const badge = `${BASE}/badges/x.png`;
    expect(toProxyUrl(badge, { type: 'post', id: 'p1' })).toBe(badge);
  });

  it('leaves external and non-storage URLs unchanged', () => {
    const ext = 'https://lh3.googleusercontent.com/a/x';
    expect(toProxyUrl(ext, { type: 'post', id: 'p1' })).toBe(ext);
  });

  it('passes null/empty through', () => {
    expect(toProxyUrl(null, { type: 'post', id: 'p1' })).toBeNull();
    expect(toProxyUrl(undefined, { type: 'post', id: 'p1' })).toBeNull();
    expect(toProxyUrl('', { type: 'post', id: 'p1' })).toBeNull();
  });

  it('strips query/fragment and decodes the key', () => {
    const out = toProxyUrl(`${BASE}/uploads/posts/u1/a%20b.jpg?token=x#frag`, { type: 'post', id: 'p1' });
    const token = out!.slice('/api/media/'.length);
    expect(verifyMediaToken(token)?.k).toBe('posts/u1/a b.jpg');
  });

  it('fails OPEN to the raw URL when no signing secret is set', () => {
    delete process.env.MEDIA_PROXY_SECRET;
    const raw = `${BASE}/uploads/posts/u1/a.jpg`;
    // No 500 / throw — the response degrades to the raw public URL, which is
    // safe while the bucket is still public (the flip is gated on the secret).
    expect(toProxyUrl(raw, { type: 'post', id: 'p1' })).toBe(raw);
  });

  it('isProtectedBucket', () => {
    expect(isProtectedBucket('uploads')).toBe(true);
    expect(isProtectedBucket('avatars')).toBe(false);
  });
});

describe('fromProxyUrl / healStoredMediaUrl — a proxied path back to its stored URL (Oct 4 2026)', () => {
  beforeEach(() => {
    process.env.MEDIA_PROXY_SECRET = 'test-secret-bbbbbbbbbbbbbbbbbbbbbbbb';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
  });
  afterEach(() => {
    delete process.env.MEDIA_PROXY_SECRET;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it('round-trips a stored URL through the proxy and back', async () => {
    const { fromProxyUrl, healStoredMediaUrl } = await import('../proxy-url');
    const stored = `${BASE}/uploads/posts/u1/a b.jpg`;
    const proxied = toProxyUrl(stored, { type: 'workout', id: 'p1' })!;
    expect(proxied.startsWith('/api/media/')).toBe(true);
    expect(fromProxyUrl(proxied)).toBe(`${BASE}/uploads/posts/u1/a%20b.jpg`);
    expect(healStoredMediaUrl(proxied)).toBe(`${BASE}/uploads/posts/u1/a%20b.jpg`);
    // The optimizable form and a query string are the same object.
    const pub = toProxyUrl(stored, { type: 'post', id: 'p1' }, { visibility: 'public' })!;
    expect(fromProxyUrl(`${pub}?w=200`)).toBe(`${BASE}/uploads/posts/u1/a%20b.jpg`);
  });

  it('refuses a forged or unverifiable proxied path, and leaves anything else alone', async () => {
    const { fromProxyUrl, healStoredMediaUrl } = await import('../proxy-url');
    expect(fromProxyUrl('/api/media/not-a-token')).toBeNull();
    expect(healStoredMediaUrl('/api/media/not-a-token')).toBeNull();
    const proxied = toProxyUrl(`${BASE}/uploads/posts/u1/a.jpg`, { type: 'workout', id: 'p1' })!;
    const forged = proxied.slice(0, -2) + (proxied.endsWith('A') ? 'BB' : 'AA');
    expect(fromProxyUrl(forged)).toBeNull();
    expect(healStoredMediaUrl(`${BASE}/uploads/posts/u1/a.jpg`)).toBe(`${BASE}/uploads/posts/u1/a.jpg`);
    expect(healStoredMediaUrl('https://lh3.googleusercontent.com/x')).toBe('https://lh3.googleusercontent.com/x');
    expect(fromProxyUrl('https://example.com/api/media/abc.def')).toBeNull();
  });
});
