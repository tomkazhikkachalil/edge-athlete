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
