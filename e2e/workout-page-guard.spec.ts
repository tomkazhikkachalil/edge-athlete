import { test, expect } from '@playwright/test';

// Workout capture round PR 3 (Oct 9 2026): a signed-out visit to a workout
// (what an iPhone that threw the page away with the camera up and then
// missed the 5 s auth boot looks like) lands on the sign-in page WITH the
// way back — `/?next=/app/workout/<id>` — never a bare `/`. The sign-in
// page already honours `?next=` (the invite claim's path); this pins the
// workout's door onto it.

test.use({ storageState: { cookies: [], origins: [] } });

test('signed out, a workout page bounces to sign-in with the return path @mobile', async ({ page }) => {
  const id = '00000000-0000-4000-8000-000000000001';
  await page.goto(`/app/workout/${id}`);
  await page.waitForURL(url => url.pathname === '/' && url.searchParams.get('next') === `/app/workout/${id}`, { timeout: 20_000 });
  // The sign-in form (its button reads "Login", one word).
  await expect(page.getByPlaceholder('Enter your password')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
});
