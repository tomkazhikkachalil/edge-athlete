import { test, expect } from '@playwright/test';
import { loadQaUser } from './helpers/qa-user';

// The doors to the recorder (Live Activities PR 6): Vitals' header pill, the
// Activities section's link, the header's Create sheet. Reachability at
// phone width is part of parity — a surface behind a desktop-only entry
// has not shipped on mobile.

test('the recorder is reachable from Vitals and from Create @mobile', async ({ page }) => {
  test.setTimeout(90_000);
  const user = loadQaUser('user.json');
  await page.goto(`/athlete/${user.id}?tab=vitals`);
  const pill = page.locator('[data-vitals-record-activity]');
  await expect(pill).toBeVisible({ timeout: 20_000 });
  await pill.click();
  await expect(page).toHaveURL(/\/activities\/record$/);
  await expect(page.locator('[data-record-type-picker]')).toBeVisible({ timeout: 20_000 });

  await page.goto(`/athlete/${user.id}?tab=activities`);
  const link = page.locator('[data-activities-record-link]');
  await expect(link).toBeVisible({ timeout: 20_000 });
  await link.click();
  await expect(page).toHaveURL(/\/activities\/record$/);

  await page.goto('/feed');
  await page.getByRole('button', { name: 'Create' }).first().click();
  await page.locator('[data-create-record-activity]').click();
  await expect(page).toHaveURL(/\/activities\/record$/);
  await expect(page.locator('[data-record-type-picker]')).toBeVisible({ timeout: 20_000 });
});
