import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readConnectState, signConnectState, PKCE_COOKIE, PKCE_COOKIE_PATH } from '../youtube-oauth-server';
import { isPkceVerifier, pkcePair, youtubeAuthorizeUrl, youtubeConfig } from '../google-youtube-server';
import { createHash } from 'node:crypto';

// Videos program Phase 3 (Nov 5 2026): the connect flow's state and PKCE.

const P = '11111111-1111-4111-8111-111111111111';
const O = '22222222-2222-4222-8222-222222222222';

beforeAll(() => { process.env.CONNECTIONS_ENC_KEY = randomBytes(32).toString('base64'); });

describe('the signed connect state', () => {
  it('round-trips the owner and the scope for the account that started it, and no one else', () => {
    const state = signConnectState('user-1', { kind: 'org', side: 'club', orgId: O }, 'upload');
    expect(readConnectState(state, 'user-1')).toEqual({ owner: { kind: 'org', side: 'club', orgId: O }, scope: 'upload' });
    expect(readConnectState(state, 'user-2')).toBeNull();
    expect(readConnectState(state + 'x', 'user-1')).toBeNull();
    expect(readConnectState(null, 'user-1')).toBeNull();
    const profile = signConnectState('user-1', { kind: 'profile', profileId: P }, 'readonly');
    expect(readConnectState(profile, 'user-1')).toEqual({ owner: { kind: 'profile', profileId: P }, scope: 'readonly' });
  });
  it('a state made for another provider is refused before the signature is even checked', () => {
    const polarish = Buffer.from(JSON.stringify({ u: 'user-1', p: 'polar', t: Date.now(), n: 'x' })).toString('base64url') + '.sig';
    expect(readConnectState(polarish, 'user-1')).toBeNull();
  });
  it('the PKCE cookie is scoped to the two routes', () => {
    expect(PKCE_COOKIE).toBe('ea-yt-pkce');
    expect(PKCE_COOKIE_PATH).toBe('/api/videos/youtube');
  });
});

describe('PKCE and the consent URL', () => {
  it('the verifier is base64url of 32 bytes and the challenge its S256', () => {
    const { verifier, challenge } = pkcePair();
    expect(isPkceVerifier(verifier)).toBe(true);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(isPkceVerifier('short')).toBe(false);
    expect(isPkceVerifier('a'.repeat(43) + '!')).toBe(false);
  });
  it('the authorize URL asks offline, with consent, incremental, S256 — and only when both credentials are set', () => {
    expect(youtubeConfig({})).toBeNull();
    expect(youtubeConfig({ YOUTUBE_CLIENT_ID: 'id' })).toBeNull();
    const cfg = youtubeConfig({ YOUTUBE_CLIENT_ID: 'id', YOUTUBE_CLIENT_SECRET: 'secret' })!;
    expect(cfg.authBase).toBe('https://accounts.google.com');
    expect(cfg.apiBase).toBe('https://www.googleapis.com');
    const mocked = youtubeConfig({ YOUTUBE_CLIENT_ID: 'id', YOUTUBE_CLIENT_SECRET: 'secret', YOUTUBE_MOCK_BASE: 'http://127.0.0.1:4872/' })!;
    expect(mocked.authBase).toBe('http://127.0.0.1:4872');
    const prodIgnores = youtubeConfig({ YOUTUBE_CLIENT_ID: 'id', YOUTUBE_CLIENT_SECRET: 'secret', YOUTUBE_MOCK_BASE: 'http://127.0.0.1:4872', VERCEL_ENV: 'production' })!;
    expect(prodIgnores.authBase).toBe('https://accounts.google.com');
    const u = new URL(youtubeAuthorizeUrl(cfg, { state: 's', redirectUri: 'https://x/cb', scopes: ['a', 'b'], codeChallenge: 'c' }));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ response_type: 'code', client_id: 'id', redirect_uri: 'https://x/cb', scope: 'a b', state: 's', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', code_challenge: 'c', code_challenge_method: 'S256' });
  });
});
