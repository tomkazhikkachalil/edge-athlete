import { test, expect, type Page } from './helpers/test';

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
/**
 * The most /api calls a cold /feed may make before it settles. Measured on the
 * `mobile` project against the built app, Nov 7 2026: 23 after Phase 2's strip
 * change (follow/stats 5, me/pulse 2, relay 3 among them); 14 after Phase 2d
 * cut those three — posts 1, notifications 1, messages 1, drafts 1, live-now 1,
 * suggestions 1 (the follow stats ride inside it), me/pulse 1, guardian/athletes
 * 1, calendar/events 1, workout-routines 1, getting-started 1, organizations 1,
 * seen 1, push/config 1. The page-timings beacon is counted apart (apiPath).
 * It ratchets DOWN; raising it is a decision in the devlog.
 */
const OPEN_PATH_API_BUDGET = 14;
/**
 * The most the feed may shift while it loads (the browser's layout-shift score; "good" is 0.1). Measured on the `mobile`
 * project, CPU ×4, Nov 11 2026: 0.441 before — ONE shift, the Suggested Connections card's pulsing skeleton wrapper
 * reused by React as the list's header row — and 0 after the two were keyed apart, on a cold open and on a return that
 * paints the device-remembered page first. It ratchets DOWN; raising it is a decision in the devlog.
 */
const FEED_CLS_BUDGET = 0.05;

interface Sample {
  engine: string;
  firstPostMs: number;
  apiOnLoad: number;
  apiByPath: Record<string, number>;
  jsKB: number | null;
  imageCache: string | null;
  afterRefocus: { posts: number; notifications: number; messages: number };
  afterTokenRefresh: { posts: number; notifications: number; profile: number };
  /** The feed's layout shift (Nov 11 2026): the cold open, and a return visit that paints the device-remembered page first. */
  cls: { cold: number; coldTop: ShiftSource[]; reopen: number; reopenTop: ShiftSource[] };
}

interface ShiftSource { el: string; value: number; atMs: number; dy: number }

/**
 * Every layout shift the browser reports, with the elements that moved — installed before any page script. The score is
 * the browser's own (the sum of the shifts that did not follow an input; the page's session windows are one window here,
 * a load being a few seconds). `el` names a moved element by its data attributes, test id or first classes.
 */
async function watchShifts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __shifts: Array<{ value: number; atMs: number; sources: Array<{ el: string; dy: number }> }> };
    w.__shifts = [];
    const name = (n: Node | null): string => {
      const e = n && n.nodeType === 1 ? (n as Element) : n?.parentElement ?? null;
      if (!e) return '(gone)';
      const data = Array.from(e.attributes).filter(a => a.name.startsWith('data-') && a.name !== 'data-state').slice(0, 2).map(a => `[${a.name}${a.value ? `="${a.value.slice(0, 24)}"` : ''}]`).join('');
      const cls = typeof e.className === 'string' ? e.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.') : '';
      return `${e.tagName.toLowerCase()}${data || (cls ? `.${cls}` : '')}`;
    };
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean; startTime: number; sources?: Array<{ node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }> }>) {
          if (entry.hadRecentInput) continue;
          w.__shifts.push({ value: entry.value, atMs: Math.round(entry.startTime), sources: (entry.sources ?? []).map(src => ({ el: name(src.node), dy: Math.round(src.currentRect.top - src.previousRect.top) })) });
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {
      /* an engine without the entry type reports nothing (WebKit) */
    }
  });
}

async function readShifts(page: Page): Promise<{ total: number; top: ShiftSource[] }> {
  const shifts = await page.evaluate(() => (window as unknown as { __shifts?: Array<{ value: number; atMs: number; sources: Array<{ el: string; dy: number }> }> }).__shifts ?? []);
  const total = Math.round(shifts.reduce((sum, x) => sum + x.value, 0) * 1000) / 1000;
  const top = [...shifts].sort((a, b) => b.value - a.value).slice(0, 8).map(x => {
    const moved = [...x.sources].sort((a, b) => Math.abs(b.dy) - Math.abs(a.dy))[0];
    return { el: moved?.el ?? '(no source)', value: Math.round(x.value * 1000) / 1000, atMs: x.atMs, dy: moved?.dy ?? 0 };
  });
  return { total, top };
}

function apiPath(url: string): string | null {
  const u = new URL(url);
  if (!u.pathname.startsWith('/api/')) return null;
  // The page-timings beacon (migration 305) is the INSTRUMENT: one sendBeacon
  // two seconds after the metrics settle, counted apart — it measures the open,
  // it is not part of it. Every other /api call is.
  if (u.pathname === '/api/page-timings') return null;
  // The post-view beacon is the same kind of thing (Nov 11 2026): it REPORTS which posts were on screen long enough to
  // count, and whether it fires inside the settle window depends on the viewport — a desktop shows posts at once (15
  // calls, found failing on main), a phone does not (14). It is not a read the open waits for; counted apart.
  if (u.pathname === '/api/posts/views') return null;
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

  await watchShifts(page);
  // A controllable clock (the token-refresh phase fast-forwards it).
  await page.clock.install();
  const t0 = Date.now();
  await page.goto('/feed');
  await expect(page.getByTestId('post-card').first()).toBeVisible({ timeout: 45_000 });
  const firstPostMs = Date.now() - t0;
  // Let the load settle (the side widgets, the bell, the realtime handshake).
  await page.waitForTimeout(6_000);
  const coldShifts = await readShifts(page);
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
  const profileReadsOnRefresh = profileReads; // read NOW: the reload below reads the profile, as any open does

  // A return visit: the device-remembered page paints first, then the fresh one replaces it (Phase 2b).
  await page.reload();
  await expect(page.getByTestId('post-card').first()).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(6_000);
  const reopenShifts = await readShifts(page);

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
      profile: profileReadsOnRefresh,
    },
    cls: { cold: coldShifts.total, coldTop: coldShifts.top, reopen: reopenShifts.total, reopenTop: reopenShifts.top },
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
  // The open path's budget (performance program, Phase 2 — Nov 2026): how
  // many /api calls a cold /feed makes before it settles. Each one is a round
  // trip, and right after a deploy each one may land on a cold function
  // (docs/load/2026-11-07/cold-after-warm.md). The Live Now strip is ONE
  // call (`/api/live-now`), not three. The number ratchets DOWN; raising it
  // is a decision written in the devlog.
  expect(sample.apiOnLoad, `the open path grew: ${JSON.stringify(sample.apiByPath)}`).toBeLessThanOrEqual(OPEN_PATH_API_BUDGET);
  expect(sample.apiByPath['/api/live-now'] ?? 0, 'the Live Now strip reads /api/live-now once').toBe(1);
  expect((sample.apiByPath['/api/golf/live-now'] ?? 0) + (sample.apiByPath['/api/sport-events/live-now'] ?? 0) + (sample.apiByPath['/api/videos/live-now'] ?? 0), 'the strip no longer calls the three live-now routes').toBe(0);
  // Phase 2d: the suggestions carry the follow stats, the pulse is read once, the browser sends no beacon without an error.
  expect(sample.apiByPath['/api/follow/stats'] ?? 0, 'the suggested people asked /api/follow/stats one by one').toBe(0);
  expect(sample.apiByPath['/api/me/pulse'] ?? 0, 'the pulse was read more than once on load').toBeLessThanOrEqual(1);
  expect(sample.apiByPath['/api/relay'] ?? 0, 'the browser sent Sentry beacons on a clean load').toBe(0);
  // The feed holds still while it loads — a cold open, and a return that paints the remembered page first.
  expect(sample.cls.cold, `the feed shifted on a cold open: ${JSON.stringify(sample.cls.coldTop)}`).toBeLessThanOrEqual(FEED_CLS_BUDGET);
  expect(sample.cls.reopen, `the feed shifted on a return visit: ${JSON.stringify(sample.cls.reopenTop)}`).toBeLessThanOrEqual(FEED_CLS_BUDGET);
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

