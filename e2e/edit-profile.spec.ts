import { test, expect, type Page } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// Edit Profile opens filled in, and an edit shows everywhere (Sep 30 2026).
//
// Production, the day after go-live: Edit Profile opened with every field
// blank, and a saved change did not reach the header or Settings. Three
// faults, each pinned here:
//   1. the forms were filled only when the profile prop CHANGED after mount,
//      and every host mounts the modal with the profile already loaded;
//   2. three hosts (Settings, Feed, Notifications) closed without re-reading
//      the shared profile;
//   3. a name edit never reached full_name / display_name.
// Plus the same mount-time fault on the Privacy tab and on the deep-link tab.
//
// Every test starts from a FRESH document (page.goto) — that is the failing
// case: the profile is loaded before the modal first mounts. @mobile: the
// phone width on Chromium and on WebKit.

const COLUMNS = 'first_name, last_name, full_name, display_name, bio, location, dob, birthday, class_year, social_instagram, sport' as const;
const SEED = {
  bio: 'Seeded bio for the edit-profile spec.',
  location: 'Seedville',
  dob: '1995-06-15',
  birthday: '1995-06-15',
  class_year: 2031,
  social_instagram: 'edgeqa_seeded',
  sport: 'Golf',
};

let prior: Record<string, unknown> | null = null;

test.beforeAll(async () => {
  const alpha = loadQaUser('user.json');
  const admin = adminClient();
  const { data, error } = await admin.from('profiles').select(COLUMNS).eq('id', alpha.id).single();
  if (error || !data) throw new Error(`edit-profile: could not read the QA profile: ${error?.message}`);
  prior = data as Record<string, unknown>;
  const { error: seedError } = await admin.from('profiles').update(SEED).eq('id', alpha.id);
  if (seedError) throw new Error(`edit-profile: seeding failed: ${seedError.message}`);
});

test.afterAll(async () => {
  if (!prior) return;
  const alpha = loadQaUser('user.json');
  // Other specs assert on this user's names — put every column back exactly.
  const { error } = await adminClient().from('profiles').update(prior).eq('id', alpha.id);
  if (error) throw new Error(`edit-profile: restore failed: ${error.message}`);
});

// Scoped to the dialog: /athlete has its own "Profile sections" tab row
// (with its own Vitals tab) behind the modal.
const tab = (page: Page, name: string) =>
  page
    .getByRole('dialog', { name: 'Edit Profile', exact: true })
    .getByRole('navigation', { name: 'Profile sections' })
    .getByRole('button', { name, exact: true });

async function expectFilled(page: Page) {
  await expect(page.locator('#first_name')).toHaveValue(String(prior!.first_name), { timeout: 20_000 });
  await expect(page.locator('#last_name')).toHaveValue(String(prior!.last_name));
  await expect(page.locator('#bio')).toHaveValue(SEED.bio);
  await tab(page, 'Vitals').click();
  await expect(page.locator('#dob')).toHaveValue(SEED.dob);
  await expect(page.locator('#location')).toHaveValue(SEED.location);
  await expect(page.locator('#class_year')).toHaveValue(String(SEED.class_year));
  await tab(page, 'Socials').click();
  await expect(page.locator('#instagram')).toHaveValue(SEED.social_instagram);
}

test('Edit Profile opens filled in on a fresh load — from Settings and from the feed @mobile', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Edit Profile Details' }).click();
  await expectFilled(page);

  await page.goto('/feed');
  await page.getByRole('button', { name: 'Toggle mobile menu' }).click();
  await page.getByRole('button', { name: 'Edit Profile', exact: true }).click();
  await expectFilled(page);
});

test('a name edit from Settings shows without a reload, and reaches full_name + display_name @mobile', async ({ page }) => {
  const alpha = loadQaUser('user.json');
  const newFirst = `Edgar${Math.random().toString(36).slice(2, 6)}`;
  const expected = `${newFirst} ${prior!.last_name}`;

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Edit Profile Details' }).click();
  await expect(page.locator('#first_name')).toHaveValue(String(prior!.first_name), { timeout: 20_000 });
  await page.locator('#first_name').fill(newFirst);
  await page.getByRole('button', { name: 'Save Basic' }).click();

  // The Settings host closes on save; the Account tab behind it reads the
  // SHARED profile — no reload between the save and this assertion.
  await expect(page.locator('#first_name')).toBeHidden({ timeout: 20_000 });
  await expect(page.getByText(expected, { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  // The derived columns followed (the server's rule, never the client's copy).
  const res = await page.request.get(`/api/profile?id=${alpha.id}`);
  expect(res.status(), await res.text()).toBe(200);
  const body = await res.json();
  expect(body.profile).toMatchObject({ first_name: newFirst, full_name: expected, display_name: expected });
  // The save came moments after the modal mounted. A Basic save that beats
  // the sports list must not clear the primary sport (it used to send '').
  expect(body.profile.sport).toBe(SEED.sport);

  // Reopening shows what was saved — not the stale pre-save profile.
  await page.getByRole('button', { name: 'Edit Profile Details' }).click();
  await expect(page.locator('#first_name')).toHaveValue(newFirst);

  // Back to the seeded names for the tests that follow (afterAll restores the rest).
  const { error } = await adminClient()
    .from('profiles')
    .update({ first_name: prior!.first_name, full_name: prior!.full_name, display_name: prior!.display_name })
    .eq('id', alpha.id);
  expect(error).toBeNull();
});

test('a private profile\'s Privacy tab opens on Private @mobile', async ({ page }) => {
  // The QA users are private. The tab used to open on "Public" for everyone.
  await page.goto('/settings?tab=privacy');
  const pressed = page.locator('button[aria-pressed="true"]');
  await expect(pressed).toHaveCount(1, { timeout: 20_000 });
  await expect(pressed.getByRole('heading', { name: 'Private' })).toBeVisible();
});

test('the deep link opens the sport tab; unsaved typing in another tab survives a save; Discard discards @mobile', async ({ page }) => {
  const alpha = loadQaUser('user.json');
  const admin = adminClient();

  // A COLD load of the deep link: the modal mounts already open.
  await page.goto('/athlete?edit=sport');
  await expect(tab(page, 'Golf')).toHaveAttribute('aria-current', 'page', { timeout: 20_000 });

  // Type in Vitals, then save Basic.
  await tab(page, 'Vitals').click();
  await expect(page.locator('#class_year')).toHaveValue(String(SEED.class_year));
  await page.locator('#class_year').fill('2033');
  await tab(page, 'Basic').click();
  const newBio = `Saved from the Basic tab ${Math.random().toString(36).slice(2, 8)}`;
  await page.locator('#bio').fill(newBio);
  await page.getByRole('button', { name: 'Save Basic' }).click();
  await expect
    .poll(async () => (await admin.from('profiles').select('bio').eq('id', alpha.id).single()).data?.bio, { timeout: 20_000 })
    .toBe(newBio);
  await expect(page.getByRole('button', { name: 'Save Basic' })).toBeEnabled({ timeout: 15_000 });

  // The save re-read the shared profile; the Vitals typing is still there.
  await tab(page, 'Vitals').click();
  await expect(page.locator('#class_year')).toHaveValue('2033');

  // …and still counts as unsaved: closing asks, Discard discards, a reopen
  // shows the stored value again.
  await page.getByRole('button', { name: 'Close modal' }).click();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.locator('#class_year')).toBeHidden();
  await page.getByRole('button', { name: 'Toggle mobile menu' }).click();
  await page.getByRole('button', { name: 'Edit Profile', exact: true }).click();
  // A plain reopen keeps the tab it was closed on (Vitals).
  await expect(page.locator('#class_year')).toHaveValue(String(SEED.class_year), { timeout: 15_000 });
  await tab(page, 'Basic').click();
  await expect(page.locator('#bio')).toHaveValue(newBio);

  // The Basic save must not have cleared the seeded bio for the other tests.
  const { error } = await admin.from('profiles').update({ bio: SEED.bio }).eq('id', alpha.id);
  expect(error).toBeNull();
});
