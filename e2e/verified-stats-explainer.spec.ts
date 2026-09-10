import { test, expect } from '@playwright/test';

// Recruiting skeleton R5 — the verified-stats explainer: a public page (the
// ladder a scout interrogates), signed-out, with the way back the BrandBar
// carries. @mobile: the rungs stack at phone width.

test('help: /help/verified-stats renders the six rungs and the unconfirmed marker for a stranger @mobile', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const page = await ctx.newPage();
    await page.goto('/help/verified-stats');
    await expect(page.getByRole('heading', { level: 1, name: 'How verified stats work' })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-provenance-rung]')).toHaveCount(6);
    await expect(page.locator('[data-provenance-rung="sanctioned"]')).toContainText('Sanctioned');
    await expect(page.locator('[data-provenance-rung="entered"]')).toContainText('Self-reported');
    await expect(page.getByText('Unconfirmed', { exact: true })).toBeVisible();
    // Never a dead end: the BrandBar's escape link is there for a stranger.
    await expect(page.getByRole('link', { name: /sign in|log in/i }).first()).toBeVisible();
    const width = page.viewportSize()?.width ?? 1280;
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow').toBeLessThanOrEqual(width);
  } finally {
    await ctx.close();
  }
});
