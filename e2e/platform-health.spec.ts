import { test, expect } from './helpers/test';
import { adminClient, loadEnv } from './helpers/qa-user';

// The health sampler (flow changes item 2b — H3, Oct 19 2026, migration
// 267): the cron door answers 401 without the secret; with it, one index
// probe becomes one row in platform_health_samples (ok, a latency), old
// rows are pruned past 14 days; GET and POST alike (pg_net posts). The
// public /api/health shares the probe. Self-skips pre-267. @mobile.

test('health sampler: 401 without the secret, one row with it, the prune @mobile', async ({ browser }) => {
  test.setTimeout(60_000);
  const admin = adminClient();
  const probe = await admin.from('platform_health_samples').select('at').limit(1);
  test.skip(!!probe.error, `platform_health_samples missing — run migration 267 (${probe.error?.message})`);
  loadEnv();
  const secret = process.env.CRON_SECRET;
  test.skip(!secret, 'CRON_SECRET unset for this target');
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
  try {
    expect((await ctx.request.post('/api/cron/health-sample')).status()).toBe(401);
    await admin.from('platform_health_samples').upsert({ at: old, db_ms: 1, ok: true });
    const before = Date.now();
    const res = await ctx.request.post('/api/cron/health-sample', { headers: { authorization: `Bearer ${secret}` } });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { ok: boolean; supported: boolean; dbMs: number; pruned: number };
    expect(body.supported).toBe(true);
    expect(body.ok).toBe(true);
    expect(body.dbMs).toBeGreaterThanOrEqual(0);
    expect(body.pruned).toBeGreaterThanOrEqual(1);
    const { data: rows } = await admin.from('platform_health_samples').select('at, db_ms, ok').gte('at', new Date(before - 1000).toISOString());
    expect(rows!.length).toBeGreaterThanOrEqual(1);
    expect(rows![0].ok).toBe(true);
    expect((await admin.from('platform_health_samples').select('at').eq('at', old)).data).toHaveLength(0);
    const get = await ctx.request.get('/api/cron/health-sample', { headers: { authorization: `Bearer ${secret}` } });
    expect(get.status()).toBe(200);
    const health = await ctx.request.get('/api/health');
    expect(health.status()).toBe(200);
    expect(((await health.json()) as { database: string }).database).toBe('ok');
  } finally {
    await ctx.close();
  }
});
