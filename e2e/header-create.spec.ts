import { test, expect } from './helpers/test';
import { apiAs } from './helpers/qa-user';

// The header "+" on pages without their own composer mount (explore, live,
// messages, calendar, settings…) used to router.push('/athlete') — it
// silently navigated instead of composing. It now hands off to the feed's
// ?create=1 deep link, the same battle-tested path the rounds page and the
// onboarding CTA use. This guards the handoff end-to-end from two such pages.
// Events program: the button is now "Create" and opens the sheet; Post is the
// same handoff as before. Create menu redesign (Oct 13 2026): the sheet is
// Post · Sport · Event · Record Activity (a second step: Start a workout |
// Record activity) — the Sport and Record tests below are @smoke so CI
// protects the menu.
for (const route of ['/sports/explore', '/messages']) {
  test(`header + on ${route} opens the composer via /feed?create=1`, async ({ page }) => {
    await page.goto(route);
    // Desktop viewport (1280×800): the "+ Create" button is in the header
    // directly — no drawer needed.
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.locator('[data-create-post]').click();

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

  try {
    await page.goto('/athlete');
    const rounds = page.getByRole('link', { name: /view all rounds/i });
    const trends = page.getByRole('link', { name: /trends/i }).first();
    await expect(rounds).toBeVisible({ timeout: 15_000 });
    await expect(trends).toBeVisible();

    // Reachable, not just countable: the link must actually take the click.
    await rounds.click();
    await expect(page).toHaveURL(/\/app\/sport\/golf\/rounds/);
    await expect(page.getByRole('heading', { name: /my rounds/i })).toBeVisible({ timeout: 15_000 });
  } finally {
    // Undo the declaration: the QA user is SHARED across specs running in
    // parallel, and a declared sport flips the feed composer's default to
    // golf — which HIDES the caption textarea and broke media-editor /
    // media-reedit whenever this test ran first (caught Aug 25, capture
    // round). A sported user is this test's fixture, not the suite's.
    const undo = await api.put('/api/profile', { data: { profileData: { sport: null } } });
    expect(undo.ok()).toBeTruthy();
    await api.dispose();
  }
});

// The sheet's second door: Event → the creation wizard (Events program).
test('header Create → Event opens the wizard', async ({ page }) => {
  await page.goto('/messages');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('[data-create-event]').click();
  await expect(page).toHaveURL(/\/sports\/events\/new/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Create an event' })).toBeVisible({ timeout: 15_000 });
});

// Create menu redesign (Oct 13 2026): the four doors and the second step.
test('header Create shows Post, Sport, Event and Record Activity — nothing else; Sport opens the composer with the sport picker @smoke', async ({ page }) => {
  await page.goto('/messages');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const sheet = page.locator('[data-create-sheet]');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button')).toHaveCount(4);
  for (const hook of ['post', 'sport', 'event', 'record-activity']) await expect(sheet.locator(`[data-create-${hook}]`)).toBeVisible();
  await expect(sheet.locator('[data-create-activity]')).toHaveCount(0);
  await expect(sheet.getByText(/import/i)).toHaveCount(0);

  // Sport → the feed's composer, with "Select Sport" already open; golf → the live-round setup.
  await sheet.locator('[data-create-sport]').click();
  await expect(page).toHaveURL(/\/feed/, { timeout: 15_000 });
  const picker = page.locator('div[class*="z-[60]"]');
  await expect(picker.getByRole('heading', { name: 'Select Sport' })).toBeVisible({ timeout: 15_000 });
  await picker.getByPlaceholder('Search sports...').fill('golf');
  await picker.getByRole('button', { name: /golf/i }).first().click();
  await expect(page.getByPlaceholder(/search for a golf course/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Playing now')).toBeVisible();
});

test('header Create → Record Activity is a second step: Start a workout | Record activity; Record activity opens the recorder @smoke', async ({ page }) => {
  await page.goto('/messages');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('[data-create-record-activity]').click();
  const step = page.locator('[data-create-sheet][data-create-step="record"]');
  await expect(step).toBeVisible();
  await expect(step.locator('[data-create-workout]')).toBeVisible();
  await expect(step.locator('[data-create-recording]')).toBeVisible();
  // Back returns to the four doors.
  await step.locator('[data-create-back]').click();
  await expect(page.locator('[data-create-sheet][data-create-step="root"] [data-create-sport]')).toBeVisible();
  await page.locator('[data-create-record-activity]').click();
  await page.locator('[data-create-recording]').click();
  await expect(page).toHaveURL(/\/activities\/record$/, { timeout: 15_000 });
  await expect(page.locator('[data-record-type-picker]')).toBeVisible({ timeout: 20_000 });
});
