import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signMediaToken, verifyMediaToken } from '../token';

const SECRET = 'test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('media token', () => {
  beforeEach(() => {
    process.env.MEDIA_PROXY_SECRET = SECRET;
    delete process.env.MEDIA_PROXY_SECRET_PREVIOUS;
  });
  afterEach(() => {
    delete process.env.MEDIA_PROXY_SECRET;
    delete process.env.MEDIA_PROXY_SECRET_PREVIOUS;
  });

  it('round-trips a payload', () => {
    const token = signMediaToken({ b: 'uploads', k: 'posts/u/x.jpg', t: 'post', id: 'p1' });
    expect(verifyMediaToken(token)).toEqual({ v: 1, b: 'uploads', k: 'posts/u/x.jpg', t: 'post', id: 'p1' });
  });

  it('rejects a tampered payload (MAC no longer matches)', () => {
    const token = signMediaToken({ b: 'uploads', k: 'posts/u/x.jpg', t: 'post', id: 'p1' });
    const [payloadB64, sig] = token.split('.');
    // Flip the payload to point at someone else's key, keep the old signature.
    const forgedPayload = Buffer.from(
      JSON.stringify({ v: 1, b: 'uploads', k: 'posts/victim/secret.jpg', t: 'post', id: 'p1' })
    ).toString('base64url');
    expect(verifyMediaToken(`${forgedPayload}.${sig}`)).toBeNull();
    expect(payloadB64).not.toBe(forgedPayload);
  });

  it('rejects a token signed with a different secret', () => {
    const token = signMediaToken({ b: 'uploads', k: 'a.jpg', t: 'post', id: 'p1' });
    process.env.MEDIA_PROXY_SECRET = 'a-completely-different-secret-value-000';
    expect(verifyMediaToken(token)).toBeNull();
  });

  it('accepts the previous secret during rotation', () => {
    const token = signMediaToken({ b: 'uploads', k: 'a.jpg', t: 'post', id: 'p1' });
    process.env.MEDIA_PROXY_SECRET = 'the-new-rotated-secret-value-1111111111';
    process.env.MEDIA_PROXY_SECRET_PREVIOUS = SECRET;
    expect(verifyMediaToken(token)?.k).toBe('a.jpg');
  });

  it('rejects malformed / empty / no-secret cases', () => {
    expect(verifyMediaToken('')).toBeNull();
    expect(verifyMediaToken('nodot')).toBeNull();
    expect(verifyMediaToken('.onlysig')).toBeNull();
    expect(verifyMediaToken('payload.')).toBeNull();
    const token = signMediaToken({ b: 'uploads', k: 'a.jpg', t: 'post', id: 'p1' });
    delete process.env.MEDIA_PROXY_SECRET;
    expect(verifyMediaToken(token)).toBeNull();
  });

  it('throws when signing without a secret', () => {
    delete process.env.MEDIA_PROXY_SECRET;
    expect(() => signMediaToken({ b: 'uploads', k: 'a.jpg', t: 'post', id: 'p1' })).toThrow();
  });
});
