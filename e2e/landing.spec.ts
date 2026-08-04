import { test, expect } from '@playwright/test';

// Anonymous context — the landing page is the signed-out surface.
test.use({ storageState: { cookies: [], origins: [] } });

test('landing page renders login and signup affordances', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', err => pageErrors.push(err));

  await page.goto('/');

  await expect(page.locator('input[name="email"]')).toBeVisible();
  await expect(page.locator('input[name="password"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
  // Signup entry: the Athlete role button on the signup panel.
  await expect(page.getByRole('button', { name: /athlete/i }).first()).toBeVisible();

  expect(pageErrors, pageErrors.map(e => e.message).join('\n')).toEqual([]);
});
