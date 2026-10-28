import { test, expect } from './helpers/test';
import { apiAs, loadQaUser } from './helpers/qa-user';

// Oct 10 2026 (Tom): a new post always starts as a plain General post — never
// the athlete's own sport (a golfer's composer used to open on Golf); the feed
// box says "Create a post"; Training sits beside Stats on the profile tab bar.

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
  test(`profile tabs: Training sits right after Stats on both profile routes${tag}`, async ({ page }) => {
    const me = loadQaUser('user.json');
    for (const url of ['/athlete', `/athlete/${me.id}`]) {
      await page.goto(url);
      // The profile bar's own tabs (the phone tab bar also carries data-tab).
      await expect(page.locator('[data-tab="stats"]').first()).toBeVisible({ timeout: 30_000 });
      const tabs = page.locator('[data-tab="stats"]').first().locator('xpath=..').locator('[data-tab]');
      const order = await tabs.evaluateAll(els => els.map(e => e.getAttribute('data-tab')));
      expect(order.indexOf('training'), `${url}: ${order.join(',')}`).toBe(order.indexOf('stats') + 1);
      // Reachable without scrolling the bar at phone width.
      const training = page.locator('[data-tab="training"]').first();
      const box = await training.boundingBox();
      const vw = page.viewportSize()!.width;
      expect(box && box.x + box.width <= vw, `${url}: Training inside the viewport`).toBe(true);
    }
  });
}

// Create → Sport (Oct 13 2026) is the ONE door that opens the picker itself;
// closing it without a pick still leaves a General post.
test('Create → Sport opens the sport picker; closing it leaves a General post', async ({ page }) => {
  await page.goto('/feed');
  await page.getByRole('button', { name: 'Create', exact: true }).first().click();
  await page.locator('[data-create-sport]').click();
  const selector = page.locator('div[class*="z-[60]"]');
  await expect(selector.getByRole('heading', { name: 'Select Sport' })).toBeVisible({ timeout: 15_000 });
  // Oct 27 2026: the picker offers no "General Post" — General is what a post already is.
  await expect(selector.getByText('General Post')).toHaveCount(0);
  await selector.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText('General Post', { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeVisible();
});
