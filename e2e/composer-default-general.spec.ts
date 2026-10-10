import { test, expect } from '@playwright/test';
import { apiAs, loadQaUser } from './helpers/qa-user';

// Oct 10 2026 (Tom): a new post always starts as a plain General post — never
// the athlete's own sport (a golfer's composer used to open on Golf); the feed
// box says "Create a post"; Vitals sits beside Stats on the profile tab bar.

test('a golfer\'s new post starts General: "Create a post", no golf fields', async ({ page }) => {
  const api = await apiAs('state.json');
  expect((await api.put('/api/profile', { data: { profileData: { sport: 'Golf' } } })).ok()).toBe(true);
  try {
    await page.goto('/feed');
    const prompt = page.getByRole('button', { name: 'Create a post', exact: true });
    await expect(prompt).toBeVisible({ timeout: 30_000 });
    await prompt.click();
    await expect(page.getByText('General Post', { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder('Share your thoughts...')).toBeVisible();
    await expect(page.getByPlaceholder(/search for a golf course/i)).toHaveCount(0);
    // The sport picker is still one tap away (functionality unchanged).
    await page.getByText('General Post', { exact: true }).click();
    const selector = page.locator('div[class*="z-[60]"]');
    await selector.getByPlaceholder('Search sports...').fill('golf');
    await selector.getByRole('button', { name: /golf/i }).first().click();
    await expect(page.getByPlaceholder(/search for a golf course/i)).toBeVisible();
  } finally {
    await api.put('/api/profile', { data: { profileData: { sport: null } } });
    await api.dispose();
  }
});

for (const tag of ['', ' @mobile']) {
  test(`profile tabs: Vitals sits right after Stats on both profile routes${tag}`, async ({ page }) => {
    const me = loadQaUser('user.json');
    for (const url of ['/athlete', `/athlete/${me.id}`]) {
      await page.goto(url);
      // The profile bar's own tabs (the phone tab bar also carries data-tab).
      await expect(page.locator('[data-tab="stats"]').first()).toBeVisible({ timeout: 30_000 });
      const tabs = page.locator('[data-tab="stats"]').first().locator('xpath=..').locator('[data-tab]');
      const order = await tabs.evaluateAll(els => els.map(e => e.getAttribute('data-tab')));
      expect(order.indexOf('vitals'), `${url}: ${order.join(',')}`).toBe(order.indexOf('stats') + 1);
      // Reachable without scrolling the bar at phone width.
      const vitals = page.locator('[data-tab="vitals"]').first();
      const box = await vitals.boundingBox();
      const vw = page.viewportSize()!.width;
      expect(box && box.x + box.width <= vw, `${url}: Vitals inside the viewport`).toBe(true);
    }
  });
}
