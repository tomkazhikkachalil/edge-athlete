import { test, expect } from './helpers/test';

// Workout capture round PR 3 (Oct 9 2026): a signed-out visit to a workout
// (what an iPhone that threw the page away with the camera up and then
// missed the 5 s auth boot looks like) lands on the sign-in page WITH the
// way back — `/?next=/app/workout/<id>` — never a bare `/`. The sign-in
// page already honours `?next=` (the invite claim's path); this pins the
// workout's door onto it.
//
// While the launch gate is up (production until the doors open), the
// middleware answers first: the visit lands on coming-soon carrying the
// same way back, and the page's sign-in link passes it on to the form
// (Oct 28 2026). The target says which it is — a signed-out `/feed` that
// 307s to coming-soon is a gated build; the spec asserts the matching door
// and never skips.

test.use({ storageState: { cookies: [], origins: [] } });

test('signed out, a workout page bounces to sign-in with the return path @mobile', async ({ page }) => {
  const id = '00000000-0000-4000-8000-000000000001';
  const workoutPath = `/app/workout/${id}`;

  const probe = await page.request.get('/feed', { maxRedirects: 0 });
  const gated = probe.status() === 307 && (probe.headers()['location'] ?? '').includes('/auth/coming-soon');

  await page.goto(workoutPath);
  if (gated) {
    // The gate carries the way back, then its sign-in link carries it on.
    await page.waitForURL(url => url.pathname === '/auth/coming-soon' && url.searchParams.get('next') === workoutPath, { timeout: 20_000 });
    await expect(page.locator('[data-coming-soon-signin]')).toHaveAttribute('href', `/?signin=1&next=${encodeURIComponent(workoutPath)}`);
    await page.locator('[data-coming-soon-signin]').click();
    await page.waitForURL(url => url.pathname === '/' && url.searchParams.get('signin') === '1' && url.searchParams.get('next') === workoutPath, { timeout: 20_000 });
  } else {
    await page.waitForURL(url => url.pathname === '/' && url.searchParams.get('next') === workoutPath, { timeout: 20_000 });
  }
  // The sign-in form (its button reads "Login", one word).
  await expect(page.getByPlaceholder('Enter your password')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
});
