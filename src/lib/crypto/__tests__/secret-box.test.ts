import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'crypto';
import { needsReseal, openSecret, sealSecret, secretBoxReady } from '../secret-box-server';

const KEY_A = randomBytes(32).toString('base64');
const KEY_B = randomBytes(32).toString('base64url');
const CTX = 'activity_connections:11111111-1111-4111-8111-111111111111:polar';

describe('the secret box', () => {
  const saved = { cur: process.env.CONNECTIONS_ENC_KEY, prev: process.env.CONNECTIONS_ENC_KEY_PREVIOUS };
  beforeEach(() => {
    process.env.CONNECTIONS_ENC_KEY = KEY_A;
    delete process.env.CONNECTIONS_ENC_KEY_PREVIOUS;
  });
  afterEach(() => {
    if (saved.cur === undefined) delete process.env.CONNECTIONS_ENC_KEY;
    else process.env.CONNECTIONS_ENC_KEY = saved.cur;
    if (saved.prev === undefined) delete process.env.CONNECTIONS_ENC_KEY_PREVIOUS;
    else process.env.CONNECTIONS_ENC_KEY_PREVIOUS = saved.prev;
  });

  it('round-trips a secret and never stores it in the clear', () => {
    const secret = JSON.stringify({ access_token: 'tok-éü-123', user: 42 });
    const box = sealSecret(secret, CTX);
    expect(box.startsWith('v1.')).toBe(true);
    expect(box).not.toContain('tok-');
    expect(Buffer.from(box.split('.')[3], 'base64url').toString('utf8')).not.toContain('access_token');
    expect(openSecret(box, CTX)).toBe(secret);
  });

  it('seals the same secret differently every time (a fresh nonce)', () => {
    expect(sealSecret('same', CTX)).not.toBe(sealSecret('same', CTX));
  });

  it('refuses a box moved to another row (the context is bound)', () => {
    const box = sealSecret('secret', CTX);
    expect(openSecret(box, CTX.replace('polar', 'wahoo'))).toBeNull();
    expect(openSecret(box, CTX.replace('1111-4111', '2222-4222'))).toBeNull();
  });

  it('refuses a tampered box, part by part', () => {
    const box = sealSecret('secret', CTX);
    const parts = box.split('.');
    const flip = (b64: string) => {
      const buf = Buffer.from(b64, 'base64url');
      buf[0] ^= 1;
      return buf.toString('base64url');
    };
    for (const i of [1, 2, 3]) {
      const bad = parts.map((p, j) => (j === i ? flip(p) : p)).join('.');
      expect(openSecret(bad, CTX)).toBeNull();
    }
    expect(openSecret(['v2', ...parts.slice(1)].join('.'), CTX)).toBeNull();
    expect(openSecret('not a box', CTX)).toBeNull();
    expect(openSecret(null, CTX)).toBeNull();
    expect(openSecret('', CTX)).toBeNull();
  });

  it('fails closed without a key: sealing throws, opening answers null', () => {
    const box = sealSecret('secret', CTX);
    delete process.env.CONNECTIONS_ENC_KEY;
    expect(secretBoxReady()).toBe(false);
    expect(() => sealSecret('secret', CTX)).toThrow(/CONNECTIONS_ENC_KEY/);
    expect(openSecret(box, CTX)).toBeNull();
  });

  it('treats a key of the wrong length as no key', () => {
    process.env.CONNECTIONS_ENC_KEY = Buffer.from('too short').toString('base64');
    expect(secretBoxReady()).toBe(false);
    expect(() => sealSecret('secret', CTX)).toThrow();
  });

  it('rotation: the previous key still opens, new boxes use the current key', () => {
    const old = sealSecret('secret', CTX);
    process.env.CONNECTIONS_ENC_KEY = KEY_B;
    expect(openSecret(old, CTX)).toBeNull(); // the old key is gone
    process.env.CONNECTIONS_ENC_KEY_PREVIOUS = KEY_A;
    expect(openSecret(old, CTX)).toBe('secret');
    expect(needsReseal(old, CTX)).toBe(true);
    const fresh = sealSecret('secret', CTX);
    expect(needsReseal(fresh, CTX)).toBe(false);
    delete process.env.CONNECTIONS_ENC_KEY_PREVIOUS;
    expect(openSecret(fresh, CTX)).toBe('secret');
  });
});
