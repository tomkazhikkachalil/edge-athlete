import path from 'path';
import { test, expect } from '@playwright/test';

// Offline (maintenance pass, Oct 10 2026 — Tom's section 7): a calm banner
// when the connection drops (pollers pause), ONE precached static offline
// page when a page cannot load, and captured media kept on the device until
// the post is made. The worker caches hashed JS/CSS and that page — never a
// page of the app, an API answer or user data.

test('the offline banner comes and goes with the connection @mobile', async ({ page, context }) => {
  await page.goto('/feed');
  await expect(page.getByRole('button', { name: /what's on your mind/i })).toBeVisible({ timeout: 30_000 });
  const banner = page.locator('[data-offline-banner]');
  await expect(banner).toHaveAttribute('data-offline-banner', 'hidden');
  await context.setOffline(true);
  await expect(banner).toHaveAttribute('data-offline-banner', 'offline');
  await expect(banner).toContainText("You're offline");
  await context.setOffline(false);
  await expect(banner).toHaveAttribute('data-offline-banner', 'back');
  await expect(banner).toHaveAttribute('data-offline-banner', 'hidden', { timeout: 10_000 });
});

test('a page that cannot load shows the static offline page; Retry brings the app back @mobile', async ({ page, context }, testInfo) => {
  test.skip(process.env.NEXT_PUBLIC_SW_STATIC_CACHE !== '1', 'the worker (and its offline page) is off in this deployment');
  test.skip(testInfo.project.name === 'webkit-mobile', 'service workers are blocked in the WebKit harness (playwright.config.ts)');
  test.setTimeout(120_000);
  await page.goto('/feed');
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration('/'))?.active?.scriptURL ?? null), { timeout: 30_000 })
    .toMatch(/\/sw\.js\?static=1&v=/);
  // The precache is the worker's own cache — and holds no page of the app.
  const cached = await page.evaluate(async () => {
    const names = (await caches.keys()).filter(n => n.startsWith('ea-static-'));
    const keys = names.length ? await (await caches.open(names[0])).keys() : [];
    return { names, paths: keys.map(k => new URL(k.url).pathname) };
  });
  expect(cached.names).toHaveLength(1);
  expect(cached.paths).toContain('/offline.html');
  expect(cached.paths.filter(p => p !== '/offline.html' && !p.startsWith('/_next/static/'))).toEqual([]);

  await context.setOffline(true);
  await page.goto('/athlete').catch(() => {});
  await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible({ timeout: 15_000 });
  // Try again while still offline: the same page, nothing breaks.
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible({ timeout: 15_000 });
  // The connection returns: the page reloads by itself (its \`online\` listener).
  await context.setOffline(false);
  await expect(page.getByRole('heading', { name: "You're offline" })).toBeHidden({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/athlete/);
});

test('a captured photo waits on the device: a reload offers the post back with it @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = path.join(__dirname, 'fixtures', 'photo.png');
  await page.goto('/feed');
  await page.getByRole('button', { name: /what's on your mind/i }).click();
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeVisible();
  // The camera hand-back (the photo CAPTURE input): a tile at once.
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles(fixture);
  await expect(page.getByRole('button', { name: 'Edit media', exact: true })).toBeVisible({ timeout: 5_000 });
  // The stash write and the draft follow the tile (debounced).
  await page.waitForTimeout(2_000);

  await page.reload();
  await page.getByRole('button', { name: /what's on your mind/i }).click();
  const offer = page.getByText(/You have an unfinished post/);
  await expect(offer).toContainText('1 photo or video');
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit media', exact: true })).toHaveCount(1, { timeout: 10_000 });

  // Discarding clears it: no offer next time.
  await page.reload();
  await page.getByRole('button', { name: /what's on your mind/i }).click();
  await expect(page.getByText(/You have an unfinished post/)).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: /what's on your mind/i }).click();
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeVisible();
  await expect(page.getByText(/You have an unfinished post/)).toHaveCount(0);
});
