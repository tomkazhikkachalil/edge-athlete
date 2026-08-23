import { test, expect } from '@playwright/test';
import { apiAs } from './helpers/qa-user';

// The header "+" on pages without their own composer mount (explore, live,
// messages, calendar, settings…) used to router.push('/athlete') — it
// silently navigated instead of composing. It now hands off to the feed's
// ?create=1 deep link, the same battle-tested path the rounds page and the
// onboarding CTA use. This guards the handoff end-to-end from two such pages.
for (const route of ['/explore', '/messages']) {
  test(`header + on ${route} opens the composer via /feed?create=1`, async ({ page }) => {
    await page.goto(route);
    // Desktop viewport (1280×800): the "+ Post" button is in the header
    // directly — no drawer needed.
    await page.getByRole('button', { name: 'Create new post' }).click();

    // The feed consumes ?create=1 and strips it from the URL, so asserting
    // the query races the cleanup — assert the OUTCOME: we're on /feed with
    // the composer modal open (its heading, not the inline feed bar).
    await expect(page).toHaveURL(/\/feed/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Create Post' })).toBeVisible({ timeout: 15_000 });
  });
}

// Quick links to the sport's dedicated pages (SportQuickLinks): declared by
// the sport adapter, mounted on the own profile. Before this, the rounds and
// trends pages were reachable only by direct URL — the component that carried
// their nav links (MultiSportActivity) was imported by nothing.
test('own profile shows adapter-declared sport quick links', async ({ page }) => {
  // Admin-created QA users have no declared sport; declare golf the way Edit
  // Profile does, so resolveSportKey has something to resolve.
  const api = await apiAs('state.json');
  const res = await api.put('/api/profile', { data: { profileData: { sport: 'Golf' } } });
  expect(res.ok()).toBeTruthy();
  await api.dispose();

  await page.goto('/athlete');
  const rounds = page.getByRole('link', { name: /view all rounds/i });
  const trends = page.getByRole('link', { name: /trends/i }).first();
  await expect(rounds).toBeVisible({ timeout: 15_000 });
  await expect(trends).toBeVisible();

  // Reachable, not just countable: the link must actually take the click.
  await rounds.click();
  await expect(page).toHaveURL(/\/app\/sport\/golf\/rounds/);
  await expect(page.getByRole('heading', { name: /my rounds/i })).toBeVisible({ timeout: 15_000 });
});
