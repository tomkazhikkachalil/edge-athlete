import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

// The leftovers program PR 1 (Oct 28 2026, migration 286): a write's buckets
// — `write-general` + the route's own — are checked in ONE rate_limit_hit_many
// call by requireAuth({ limit }); the route's enforceRateLimit then finds the
// memoised verdict and spends nothing. Every bucket keeps its own semantics
// (the 429 body + Retry-After, the shadow record, fail-open).
const rpc = vi.fn();
const captureMessage = vi.fn();
vi.mock('@/lib/auth-server', () => ({ getSupabaseAdmin: () => ({ rpc }) }));
vi.mock('@sentry/nextjs', () => ({ captureMessage: (...a: unknown[]) => captureMessage(...a) }));

const { enforceRateLimit, enforceRateLimitMany, RATE_LIMITS } = await import('../rate-limit');

const req = () => new NextRequest('http://localhost/api/posts/like', { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.9' } });
const rows = (wg: boolean, like: boolean, retry = 0) => ({
  data: [
    { key: 'write-general:u1', allowed: wg, retry_after_seconds: wg ? 0 : retry },
    { key: 'like:u1', allowed: like, retry_after_seconds: like ? 0 : retry },
  ],
  error: null,
});

beforeEach(() => { rpc.mockReset(); captureMessage.mockReset(); });

describe('one round trip for a write\'s buckets', () => {
  it('sends both keys with their own max/window in ONE rate_limit_hit_many call; the route\'s check then costs nothing', async () => {
    rpc.mockResolvedValueOnce(rows(true, true));
    const r = req();
    expect(await enforceRateLimitMany(r, ['write-general', 'like'], { userId: 'u1' })).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('rate_limit_hit_many', {
      p_keys: ['write-general:u1', 'like:u1'],
      p_max: [RATE_LIMITS['write-general'].max, RATE_LIMITS.like.max],
      p_window_seconds: [RATE_LIMITS['write-general'].windowSeconds, RATE_LIMITS.like.windowSeconds],
    });
    expect(await enforceRateLimit(r, 'like', { userId: 'u1' })).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1); // the memo answered
  });

  it('a refused route bucket is the same 429 as before — body, status, Retry-After — from the first call and from the memo', async () => {
    rpc.mockResolvedValueOnce(rows(true, false, 7));
    const r = req();
    const refused = await enforceRateLimitMany(r, ['write-general', 'like'], { userId: 'u1' });
    expect(refused?.status).toBe(429);
    expect(refused?.headers.get('Retry-After')).toBe('7');
    expect(await refused?.clone().json()).toEqual({ error: 'Too many requests. Please try again later.' });
    const again = await enforceRateLimit(r, 'like', { userId: 'u1' });
    expect(again?.status).toBe(429);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('write-general over budget stays a SHADOW: nothing refused, the would-block recorded by account and route', async () => {
    rpc.mockResolvedValueOnce(rows(false, true, 30));
    expect(await enforceRateLimitMany(req(), ['write-general', 'like'], { userId: 'u1' })).toBeNull();
    expect(captureMessage).toHaveBeenCalledWith('[RATE-LIMIT] would-block "write-general"', expect.objectContaining({
      tags: expect.objectContaining({ action: 'write-general', outcome: 'would-block', account: 'u1', route: 'POST /api/posts/like' }),
    }));
  });

  it('a database without 286 fails OPEN once: the request proceeds and the route\'s check spends no second call', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'missing' } });
    const r = req();
    expect(await enforceRateLimitMany(r, ['write-general', 'like'], { userId: 'u1' })).toBeNull();
    expect(await enforceRateLimit(r, 'like', { userId: 'u1' })).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('a request that never went through the many path still checks its bucket with one rate_limit_hit', async () => {
    rpc.mockReturnValueOnce({ single: async () => ({ data: { allowed: true, retry_after_seconds: 0 }, error: null }) });
    expect(await enforceRateLimit(req(), 'like', { userId: 'u1' })).toBeNull();
    expect(rpc).toHaveBeenCalledWith('rate_limit_hit', { p_key: 'like:u1', p_max: RATE_LIMITS.like.max, p_window_seconds: RATE_LIMITS.like.windowSeconds });
  });
});

describe('the hot writes ride one round trip; migration 286 walks 094\'s function', () => {
  const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');
  it('the routes pass their bucket to requireAuth / requireActiveWriter', () => {
    expect(read('src/app/api/posts/like/route.ts')).toMatch(/requireAuth\(request, \{ limit: 'like' \}\)/);
    expect(read('src/app/api/posts/route.ts')).toMatch(/requireActiveWriter\(request, \{ limit: 'post-create' \}\)/);
    expect(read('src/app/api/follow/route.ts')).toMatch(/requireActiveWriter\(request, \{ limit: 'follow' \}\)/);
    expect(read('src/app/api/messages/[conversationId]/messages/route.ts')).toMatch(/requireActiveWriter\(request, \{ limit: 'message-send' \}\)/);
    expect(read('src/app/api/mutes/route.ts')).toMatch(/requireAuth\(request, \{ limit: 'mute' \}\)/);
    for (const f of ['src/app/api/upload/route.ts', 'src/app/api/upload/post-media/intent/route.ts', 'src/app/api/upload/post-media/route.ts', 'src/app/api/upload/avatar/route.ts', 'src/app/api/upload/cover/route.ts']) {
      expect(read(f), f).toMatch(/requireActiveWriter\(request, \{ limit: 'upload' \}\)/);
    }
  });
  it('286 calls rate_limit_hit per key, in order, service_role only', () => {
    const m = read('database/migrations/286_rate_limit_hit_many.sql');
    expect(m).toMatch(/FOR i IN 1 \.\. array_length\(p_keys, 1\) LOOP\s*SELECT h\.allowed, h\.retry_after_seconds INTO v_allowed, v_retry\s*FROM public\.rate_limit_hit\(p_keys\[i\], p_max\[i\], p_window_seconds\[i\]\) AS h;/);
    expect(m).toMatch(/REVOKE EXECUTE ON FUNCTION public\.rate_limit_hit_many\(text\[\], integer\[\], integer\[\]\) FROM PUBLIC, anon, authenticated;/);
    expect(m).toMatch(/GRANT EXECUTE ON FUNCTION public\.rate_limit_hit_many\(text\[\], integer\[\], integer\[\]\) TO service_role;/);
    expect(m).toMatch(/VALUES \(286, '286_rate_limit_hit_many\.sql'\)/);
  });
});
