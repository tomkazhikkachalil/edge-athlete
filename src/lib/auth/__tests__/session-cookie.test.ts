import { describe, it, expect } from 'vitest';
import { createChunks, stringToBase64URL } from '@supabase/ssr';
import { readAccessTokenFromCookies, supabaseStorageKey } from '../session-cookie';

const URL = 'https://abcdefghijklmnopqrst.supabase.co';
const KEY = 'sb-abcdefghijklmnopqrst-auth-token';

function jar(entries: Record<string, string>) {
  return (name: string) => entries[name];
}

describe('readAccessTokenFromCookies', () => {
  it('names the cookie the way @supabase/ssr does', () => {
    expect(supabaseStorageKey(URL)).toBe(KEY);
    expect(supabaseStorageKey('not a url')).toBeNull();
  });

  it('reads a one-chunk base64 session', async () => {
    const value = `base64-${stringToBase64URL(JSON.stringify({ access_token: 'tok.en.1', refresh_token: 'r', expires_at: 1 }))}`;
    expect(await readAccessTokenFromCookies(jar({ [KEY]: value }), URL)).toBe('tok.en.1');
  });

  it('reassembles a chunked session (.0, .1 …) exactly as the SDK wrote it', async () => {
    const big = `base64-${stringToBase64URL(JSON.stringify({ access_token: 'x'.repeat(5000), refresh_token: 'r' }))}`;
    const chunks = createChunks(KEY, big);
    expect(chunks.length).toBeGreaterThan(1);
    const entries = Object.fromEntries(chunks.map(c => [c.name, c.value]));
    expect(await readAccessTokenFromCookies(jar(entries), URL)).toBe('x'.repeat(5000));
  });

  it('reads the legacy plain-JSON form too', async () => {
    expect(await readAccessTokenFromCookies(jar({ [KEY]: JSON.stringify({ access_token: 'legacy' }) }), URL)).toBe('legacy');
  });

  it('is null for a missing cookie, garbage, or a session without a token', async () => {
    expect(await readAccessTokenFromCookies(jar({}), URL)).toBeNull();
    expect(await readAccessTokenFromCookies(jar({ [KEY]: 'base64-%%%' }), URL)).toBeNull();
    expect(await readAccessTokenFromCookies(jar({ [KEY]: '{not json' }), URL)).toBeNull();
    expect(await readAccessTokenFromCookies(jar({ [KEY]: JSON.stringify({ refresh_token: 'r' }) }), URL)).toBeNull();
    expect(await readAccessTokenFromCookies(jar({ [KEY]: JSON.stringify({ access_token: 42 }) }), URL)).toBeNull();
  });
});
