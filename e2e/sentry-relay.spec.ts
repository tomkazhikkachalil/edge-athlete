import { test, expect } from './helpers/test';

// Errors reach us from every browser (every-browser round, Oct 16 2026):
// Brave Shields drop posts to *.ingest.sentry.io, so the browser SDK sends
// through our own origin — /api/relay (next.config.ts tunnelRoute), a name
// on no blocker list. Under `brave-android` the direct host is blocked
// (helpers/brave.ts); the event still lands. One uncaught error, tagged so
// the Sentry project can ignore it.

test('a browser error reaches Sentry through /api/relay, Brave Shields included @mobile', async ({ page }) => {
  test.skip(!process.env.NEXT_PUBLIC_SENTRY_DSN, 'Sentry is not configured on this target');
  const direct: string[] = [];
  page.on('request', r => { if (/ingest(\.us)?\.sentry\.io/.test(r.url())) direct.push(r.url()); });
  await page.goto('/auth/coming-soon');
  await page.waitForLoadState('networkidle');
  const relayed = page.waitForResponse(r => r.url().includes('/api/relay') && r.request().method() === 'POST', { timeout: 30_000 });
  await page.evaluate(() => setTimeout(() => { throw new Error('e2e: sentry relay probe (ignore)'); }, 0));
  const res = await relayed;
  expect(res.status(), 'Sentry accepted the relayed event').toBeLessThan(300);
  expect(direct, 'nothing goes to the ingest host directly').toEqual([]);
});
