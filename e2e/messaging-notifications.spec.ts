import { test, expect } from '@playwright/test';

// Light render checks: a fresh QA user has no conversations or notifications,
// so these assert the authenticated surfaces load to a sane state (real
// two-user messaging needs a second fixture — v2).

test('messages page renders for an authenticated user', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', err => pageErrors.push(err));

  await page.goto('/messages');
  await expect(page).toHaveURL(/\/messages/);
  await expect(page.getByRole('heading', { name: /messages/i }).first())
    .toBeVisible({ timeout: 15_000 });
  expect(pageErrors, pageErrors.map(e => e.message).join('\n')).toEqual([]);
});

test('notifications page renders for an authenticated user', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', err => pageErrors.push(err));

  await page.goto('/app/notifications');
  await expect(page).toHaveURL(/\/app\/notifications/);
  await expect(page.getByRole('heading', { name: /notifications/i }).first())
    .toBeVisible({ timeout: 15_000 });
  expect(pageErrors, pageErrors.map(e => e.message).join('\n')).toEqual([]);
});
