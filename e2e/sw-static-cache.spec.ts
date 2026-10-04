import { test, expect } from '@playwright/test';

// The installed app's static cache (speed round 2, phase E). Runs only where
// the deployment turned it on (NEXT_PUBLIC_SW_STATIC_CACHE=1 — a Preview
// first, then production once Tom's iPhone has agreed). Pins the two things
// that matter: the worker takes the page and serves its hashed files, and
// the app's own calls still answer while it does (the Oct 2 attempt stalled
// Playwright WebKit's bell fetch — this is that check).
test('the worker caches hashed files and the app still talks @mobile', async ({ page }, testInfo) => {
  test.skip(process.env.NEXT_PUBLIC_SW_STATIC_CACHE !== '1', 'static cache off in this deployment');
  // Playwright WebKit: with ANY fetch handler installed the page's own
  // fetches hang (the bell never answers) — the Oct 2 stall, reproduced
  // here on Oct 4 with a handler that never touches them. Chromium is fine.
  // Whether a real iPhone does this is the one question that decides the
  // flag; until Tom's phone has answered, this project is a known gap.
  test.fixme(testInfo.project.name === 'webkit-mobile', 'Playwright WebKit stalls under a fetch handler — a real iPhone decides');
  test.setTimeout(120_000);
  await page.goto('/feed');
  const supported = await page.evaluate(() => 'serviceWorker' in navigator);
  test.skip(!supported, 'no service worker here');

  // Registered at boot with the deployment's URL (polled: waitForFunction
  // treats an async predicate's Promise as truthy), and it controls the page
  // after a reload.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const reg = await navigator.serviceWorker.getRegistration('/');
          return (reg?.active ?? reg?.installing ?? reg?.waiting)?.scriptURL ?? null;
        }),
      { timeout: 30_000 }
    )
    .toMatch(/\/sw\.js\?static=1$/);

  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });

  // The bell still answers under the worker (the Oct 2 stall).
  const bell = await page.evaluate(async () => (await fetch('/api/notifications/unread-count')).status);
  expect(bell).toBe(200);

  // A hashed file comes from the cache: ask for one the page loaded, twice.
  const served = await page.evaluate(async () => {
    const entry = performance.getEntriesByType('resource').find(e => e.name.includes('/_next/static/chunks/'));
    if (!entry) return null;
    const cache = await caches.open('ea-static-v1');
    const hit = await cache.match(entry.name);
    return { url: entry.name, cached: !!hit };
  });
  expect(served, 'a chunk the page loaded').not.toBeNull();
  expect(served!.cached).toBe(true);
});
