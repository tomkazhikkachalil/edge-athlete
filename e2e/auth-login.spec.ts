import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { QaUser } from './helpers/qa-user';

// Fresh context: this spec exercises the real login UI end-to-end (the other
// specs start from the minted storageState for speed).
test.use({ storageState: { cookies: [], origins: [] } });

test('UI login with email/password reaches the authenticated app', async ({ page }) => {
  const user: QaUser = JSON.parse(
    readFileSync(join(process.cwd(), 'e2e', '.auth', 'user.json'), 'utf8')
  );

  await page.goto('/');
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();

  // Onboarded users land on /athlete (see src/app/page.tsx handleLoginSubmit).
  await page.waitForURL('**/athlete', { timeout: 20_000 });
  // NOT getByText(...).first(): the nav drawer is always mounted off-canvas,
  // so the first text match is a hidden drawer copy. Anchor to a heading.
  await expect(page.getByRole('heading', { name: /edge qa/i }).first())
    .toBeVisible({ timeout: 15_000 });
});
