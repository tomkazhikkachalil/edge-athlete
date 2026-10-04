import { test, expect } from '@playwright/test';

// Speed round 2: the time ONE signed-in API call takes, measured from the
// browser's own session (ten in a row, the median). It pairs with
// /api/health's DB probe: health is one read with no auth; unread-count is
// the smallest authenticated route. With local session verification live
// (SUPABASE_JWT_SECRET set) the two should sit close together; with the
// network check they are ~100–300 ms apart. PERF_BASELINE=1 records only.
test('perf: the smallest authenticated call, ten times', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/feed');
  const sample = await page.evaluate(async () => {
    const time = async (url: string) => {
      const t0 = performance.now();
      const r = await fetch(url, { cache: 'no-store' });
      await r.text();
      return { ms: Math.round(performance.now() - t0), status: r.status };
    };
    const runs = async (url: string) => {
      const out: number[] = [];
      let status = 0;
      for (let i = 0; i < 10; i++) {
        const r = await time(url);
        out.push(r.ms);
        status = r.status;
      }
      out.sort((a, b) => a - b);
      return { status, p50: out[5], min: out[0], max: out[9] };
    };
    return { health: await runs('/api/health'), unread: await runs('/api/notifications/unread-count') };
  });
  console.log(`[perf-api] ${JSON.stringify(sample)}`);
  expect(sample.health.status).toBe(200);
  expect(sample.unread.status).toBe(200);
});
