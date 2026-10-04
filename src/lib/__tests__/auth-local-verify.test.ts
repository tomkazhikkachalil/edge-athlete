import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';

/**
 * Speed round 2: the gates' local verification + per-request memo.
 * @supabase/ssr's client is mocked so the network `getUser` is a counter.
 */
const getUser = vi.fn();
vi.mock('@supabase/ssr', async importOriginal => {
  const actual = await importOriginal<typeof import('@supabase/ssr')>();
  return {
    ...actual,
    createServerClient: () => ({ auth: { getUser } }),
  };
});

const SECRET = 'a-test-secret-that-is-long-enough-for-hs256-xxxxxxxx';
const URL = 'https://abcdefghijklmnopqrst.supabase.co';
const KEY = 'sb-abcdefghijklmnopqrst-auth-token';
const SUB = '11111111-2222-4333-8444-555555555555';

async function cookieFor(expInSeconds: number) {
  const token = await new SignJWT({ role: 'authenticated', email: 'a@b.c' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer(`${URL}/auth/v1`)
    .setAudience('authenticated')
    .setSubject(SUB)
    .setExpirationTime(Math.floor(Date.now() / 1000) + expInSeconds)
    .sign(new TextEncoder().encode(SECRET));
  const session = Buffer.from(JSON.stringify({ access_token: token, refresh_token: 'r' })).toString('base64url');
  return `${KEY}=base64-${session}`;
}

function requestWith(cookie: string) {
  return new NextRequest('https://app.example/api/x', { headers: { cookie } });
}

beforeEach(() => {
  vi.resetModules();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: SUB, email: 'net@b.c' } }, error: null });
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});
afterEach(() => {
  delete process.env.SUPABASE_JWT_SECRET;
});

describe('local session verification in the gates', () => {
  it('with the secret set, a valid cookie never reaches the network', async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
    const { getServerAuth, requireAuth } = await import('../auth-server');
    const request = requestWith(await cookieFor(600));
    const a = await getServerAuth(request);
    const b = await requireAuth(request);
    expect(a.user?.id).toBe(SUB);
    expect(b.id).toBe(SUB);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('a token within the refresh margin takes the network path (so the session refreshes)', async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
    const { requireAuth } = await import('../auth-server');
    const user = await requireAuth(requestWith(await cookieFor(30)));
    expect(user.email).toBe('net@b.c');
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('without the secret the behaviour is exactly the old one: one network call per request, shared by the gates', async () => {
    const { getServerAuth, requireAuth } = await import('../auth-server');
    const request = requestWith(await cookieFor(600));
    await getServerAuth(request);
    await requireAuth(request);
    await getServerAuth(request);
    expect(getUser).toHaveBeenCalledTimes(1);
    const other = requestWith(await cookieFor(600));
    await requireAuth(other);
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it('a bad local verify is never a 401 on its own — the network decides', async () => {
    process.env.SUPABASE_JWT_SECRET = 'a-different-secret-the-token-was-not-signed-with-zz';
    const { requireAuth } = await import('../auth-server');
    const user = await requireAuth(requestWith(await cookieFor(600)));
    expect(user.email).toBe('net@b.c');
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('fresh: true takes the network user even when the local check would pass', async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
    const { requireAuth, getServerAuth } = await import('../auth-server');
    const request = requestWith(await cookieFor(600));
    const local = await requireAuth(request);
    expect(local.email).toBe('a@b.c');
    const fresh = await requireAuth(request, { fresh: true });
    expect(fresh.email).toBe('net@b.c');
    expect(getUser).toHaveBeenCalledTimes(1);
    // a second fresh ask on the same request reuses the answer
    await getServerAuth(request, { fresh: true });
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('no session → 401 from requireAuth, null from getServerAuth (the network said so)', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
    process.env.SUPABASE_JWT_SECRET = SECRET;
    const { requireAuth, getServerAuth } = await import('../auth-server');
    const request = new NextRequest('https://app.example/api/x');
    await expect(requireAuth(request)).rejects.toMatchObject({ status: 401 });
    expect((await getServerAuth(request)).user).toBeNull();
  });
});
