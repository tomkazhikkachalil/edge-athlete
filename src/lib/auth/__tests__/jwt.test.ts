import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';
import { authIssuer, claimsToUser, jwtSecret, verifyAccessToken, MIN_REMAINING_SECONDS } from '../jwt';

const SECRET = 'a-test-secret-that-is-long-enough-for-hs256-xxxxxxxx';
const OTHER = 'another-secret-that-is-also-long-enough-yyyyyyyyyyyy';
const URL = 'https://abcdefghijklmnopqrst.supabase.co';
const ISS = authIssuer(URL);
const SUB = '11111111-2222-4333-8444-555555555555';
const NOW = 1_800_000_000;

async function sign(
  claims: Record<string, unknown>,
  opts: { secret?: string; alg?: string; exp?: number; iss?: string | null; aud?: string | null } = {}
) {
  let jwt = new SignJWT({ role: 'authenticated', email: 'a@b.c', session_id: 'sess-1', ...claims })
    .setProtectedHeader({ alg: opts.alg ?? 'HS256', typ: 'JWT' })
    .setIssuedAt(NOW)
    .setExpirationTime(opts.exp ?? NOW + 600);
  if (opts.iss !== null) jwt = jwt.setIssuer(opts.iss ?? ISS);
  if (opts.aud !== null) jwt = jwt.setAudience(opts.aud ?? 'authenticated');
  if (!('sub' in claims)) jwt = jwt.setSubject(SUB);
  return jwt.sign(new TextEncoder().encode(opts.secret ?? SECRET));
}

describe('verifyAccessToken', () => {
  it('accepts this project\'s HS256 token and returns the claims the gates use', async () => {
    const token = await sign({ user_metadata: { full_name: 'A' }, app_metadata: { provider: 'email' } });
    const claims = await verifyAccessToken(token, { secret: SECRET, issuer: ISS, now: NOW });
    expect(claims).toMatchObject({ sub: SUB, email: 'a@b.c', role: 'authenticated', aud: 'authenticated', exp: NOW + 600, session_id: 'sess-1' });
    expect(claims?.user_metadata).toEqual({ full_name: 'A' });
    const user = claimsToUser(claims!);
    expect(user.id).toBe(SUB);
    expect(user.email).toBe('a@b.c');
    expect(user.created_at).toBe(''); // not in the token — fresh: true routes never see this user
  });

  it('refuses a token within the refresh margin, so @supabase/ssr still refreshes it', async () => {
    const token = await sign({}, { exp: NOW + MIN_REMAINING_SECONDS - 1 });
    expect(await verifyAccessToken(token, { secret: SECRET, issuer: ISS, now: NOW })).toBeNull();
    expect(await verifyAccessToken(token, { secret: SECRET, issuer: ISS, now: NOW, minRemainingSeconds: 0 })).not.toBeNull();
  });

  it('refuses an expired token, the wrong secret, a tampered payload and a reshaped header', async () => {
    expect(await verifyAccessToken(await sign({}, { exp: NOW - 1 }), { secret: SECRET, issuer: ISS, now: NOW })).toBeNull();
    expect(await verifyAccessToken(await sign({}, { secret: OTHER }), { secret: SECRET, issuer: ISS, now: NOW })).toBeNull();
    const good = await sign({});
    const [h, p, s] = good.split('.');
    const tampered = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), sub: '99999999-2222-4333-8444-555555555555' })).toString('base64url')}.${s}`;
    expect(await verifyAccessToken(tampered, { secret: SECRET, issuer: ISS, now: NOW })).toBeNull();
    const noneAlg = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${p}.`;
    expect(await verifyAccessToken(noneAlg, { secret: SECRET, issuer: ISS, now: NOW })).toBeNull();
  });

  it('refuses the wrong issuer, the wrong audience, a non-UUID subject and garbage — and never throws', async () => {
    expect(await verifyAccessToken(await sign({}, { iss: 'https://evil.example/auth/v1' }), { secret: SECRET, issuer: ISS, now: NOW })).toBeNull();
    expect(await verifyAccessToken(await sign({}, { iss: null }), { secret: SECRET, issuer: ISS, now: NOW })).toBeNull();
    expect(await verifyAccessToken(await sign({}, { aud: 'anon' }), { secret: SECRET, issuer: ISS, now: NOW })).toBeNull();
    expect(await verifyAccessToken(await sign({ sub: 'not-a-uuid' }), { secret: SECRET, issuer: ISS, now: NOW })).toBeNull();
    expect(await verifyAccessToken('', { secret: SECRET, issuer: ISS, now: NOW })).toBeNull();
    expect(await verifyAccessToken('a.b.c', { secret: SECRET, issuer: ISS, now: NOW })).toBeNull();
    expect(await verifyAccessToken('x'.repeat(9000), { secret: SECRET, issuer: ISS, now: NOW })).toBeNull();
  });

  it('a role other than authenticated is kept as-is (the gates decide), anonymous is flagged', async () => {
    const claims = await verifyAccessToken(await sign({ is_anonymous: true }), { secret: SECRET, issuer: ISS, now: NOW });
    expect(claims?.is_anonymous).toBe(true);
  });
});

describe('jwtSecret / authIssuer', () => {
  it('is off without the env, or with a secret too short to be real', () => {
    expect(jwtSecret({})).toBeNull();
    expect(jwtSecret({ SUPABASE_JWT_SECRET: 'short' })).toBeNull();
    expect(jwtSecret({ SUPABASE_JWT_SECRET: SECRET })).toBe(SECRET);
  });
  it('the issuer is the project URL\'s auth path, trailing slash or not', () => {
    expect(authIssuer('https://x.supabase.co/')).toBe('https://x.supabase.co/auth/v1');
    expect(ISS).toBe(`${URL}/auth/v1`);
  });
});
