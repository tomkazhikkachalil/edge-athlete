import { test, expect, type Page } from '@playwright/test';

// How fast the app opens, and what it costs (Oct 2026 — Tom: "the app runs
// very slow, especially the mobile version that is downloaded"). One signed-in
// cold load of /feed, then the phone's everyday move: switching away and back.
//
// It REPORTS (a JSON line per engine: time to the first post, API requests on
// load, JS bytes, the image cache header) and it HOLDS the regressions the
// speed round removed, so they cannot come back:
//   - coming back to the app must not reload the feed or refetch the
//     notifications (the auth refocus storm);
//   - /api/notifications is fetched once on load, not twice.
// Phones run with the CPU slowed ×4 on Chromium — a mid-range phone, not a Mac.
//
// PERF_BASELINE=1 runs it as a pure measurement (no regression assertions) —
// how the "before" numbers were taken.

const BASELINE = process.env.PERF_BASELINE === '1';

interface Sample {
  engine: string;
  firstPostMs: number;
  apiOnLoad: number;
  apiByPath: Record<string, number>;
  jsKB: number | null;
  imageCache: string | null;
  afterRefocus: { posts: number; notifications: number; messages: number };
  afterTokenRefresh: { posts: number; notifications: number; profile: number };
}

function apiPath(url: string): string | null {
  const u = new URL(url);
  if (!u.pathname.startsWith('/api/')) return null;
  return u.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, ':id').replace(/\/api\/media\/[^/]+/, '/api/media/:token');
}

async function measure(page: Page, engine: string): Promise<Sample> {
  const api: string[] = [];
  let imageCache: string | null = null;
  page.on('request', r => {
    const p = apiPath(r.url());
    if (p) api.push(p + (p === '/api/posts' && new URL(r.url()).searchParams.has('since') ? '?since' : ''));
  });
  page.on('response', r => {
    if (!imageCache && r.url().includes('/api/media/')) imageCache = r.headers()['cache-control'] ?? '(none)';
  });

  // A controllable clock (the token-refresh phase fast-forwards it).
  await page.clock.install();
  const t0 = Date.now();
  await page.goto('/feed');
  await expect(page.getByTestId('post-card').first()).toBeVisible({ timeout: 45_000 });
  const firstPostMs = Date.now() - t0;
  // Let the load settle (the side widgets, the bell, the realtime handshake).
  await page.waitForTimeout(6_000);
  const apiOnLoad = api.length;
  const apiByPath: Record<string, number> = {};
  for (const p of api) apiByPath[p] = (apiByPath[p] ?? 0) + 1;

  const jsBytes = await page.evaluate(() =>
    (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
      .filter(e => e.name.includes('/_next/static/') && e.name.endsWith('.js'))
      .reduce((sum, e) => sum + (e.transferSize || 0), 0)
  );

  // Switch away and come back — what a phone does all day. The browser's own
  // visibility events, as the OS sends them to an installed app.
  const before = api.length;
  await page.evaluate(() => {
    const set = (state: 'hidden' | 'visible') => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event(state === 'hidden' ? 'blur' : 'focus'));
    };
    set('hidden');
    return new Promise<void>(resolve =>
      setTimeout(() => {
        set('visible');
        resolve();
      }, 500)
    );
  });
  await page.waitForTimeout(6_000);
  const after = api.slice(before);
  const count = (p: string) => after.filter(x => x === p).length;

  // The session's token refresh (the app refreshes every 15 min, and a phone
  // reopening the app after a while refreshes on the spot) — the clock is
  // fast-forwarded, so every timer of those minutes runs; the polls that use
  // `?since=` are counted apart and ignored.
  const beforeRefresh = api.length;
  let profileReads = 0;
  page.on('request', r => {
    if (r.url().includes('/rest/v1/profiles?') && r.method() === 'GET') profileReads += 1;
  });
  await page.clock.runFor('16:00');
  await page.waitForTimeout(6_000);
  const refreshed = api.slice(beforeRefresh);

  return {
    engine,
    firstPostMs,
    apiOnLoad,
    apiByPath,
    jsKB: jsBytes > 0 ? Math.round(jsBytes / 1024) : null,
    imageCache,
    afterRefocus: {
      posts: count('/api/posts'),
      notifications: count('/api/notifications'),
      messages: count('/api/messages'),
    },
    afterTokenRefresh: {
      posts: refreshed.filter(x => x === '/api/posts').length,
      notifications: refreshed.filter(x => x === '/api/notifications').length,
      profile: profileReads,
    },
  };
}

async function run(page: Page, engine: string) {
  const sample = await measure(page, engine);
  console.log(`[perf] ${JSON.stringify(sample)}`);
  test.info().annotations.push({ type: 'perf', description: JSON.stringify(sample) });
  if (BASELINE) return;
  // Coming back to the app keeps the feed: no reload.
  expect(sample.afterRefocus.posts, 'the feed reloaded when the app came back').toBe(0);
  // The bell re-reads ONCE on a return to the foreground, at most every 20 s
  // (Oct 4 2026 — the installed app's realtime socket drops in the background,
  // so a read made elsewhere was never seen until a reload). One read is the
  // rule; a second would be the auth refocus storm this spec exists to catch.
  expect(sample.afterRefocus.notifications, 'notifications refetched more than once when the app came back').toBeLessThanOrEqual(1);
  // A token refresh is not a new person: nothing reloads.
  expect(sample.afterTokenRefresh.posts, 'the feed reloaded on a token refresh').toBe(0);
  // (The bell may re-read after its live connection reconnects — the
  // fast-forwarded clock starves the socket's heartbeat, and a reconnect's
  // read is correct. The profile is the auth refresh's own work: none.)
  expect(sample.afterTokenRefresh.profile, 'the profile was re-read on a token refresh').toBe(0);
  // The bell loads once.
  expect(sample.apiByPath['/api/notifications'] ?? 0, '/api/notifications fetched more than once on load').toBeLessThanOrEqual(1);
}

test('perf: a cold /feed and a return to the app (desktop)', async ({ page }) => {
  test.setTimeout(120_000);
  await run(page, 'desktop');
});

test('perf: a cold /feed and a return to the app on a phone @mobile', async ({ page, browserName }) => {
  test.setTimeout(150_000);
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  await run(page, browserName === 'chromium' ? 'phone-chromium-cpu4x' : 'phone-webkit');
});

