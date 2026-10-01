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

const COLUMNS = 'first_name, last_name, full_name, display_name, bio, location, dob, birthday, class_year, social_instagram, sport, nickname, phone, gender, postal_code, height_cm, weight_display, weight_unit, weight_kg' as const;
const SEED = {
  bio: 'Seeded bio for the edit-profile spec.',
  location: 'Seedville',
  dob: '1995-06-15',
  birthday: '1995-06-15',
  class_year: 2031,
  social_instagram: 'edgeqa_seeded',
  sport: 'Golf',
  // The private sign-up details (no nickname: it would lead display_name
  // and the name test asserts the full name does).
  phone: '416-555-0100',
  gender: 'male',
  postal_code: 'M5V 2T6',
  // 5'11" / 175 lbs — the Vitals timeline test edits these.
  height_cm: 180,
  weight_display: 175,
  weight_unit: 'lbs',
  weight_kg: 79.38,
};

let prior: Record<string, unknown> | null = null;
// Timeline rows this spec's saves append are removed in afterAll.
const startedAt = new Date().toISOString();

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
  const admin = adminClient();
  const { error } = await admin.from('profiles').update(prior).eq('id', alpha.id);
  if (error) throw new Error(`edit-profile: restore failed: ${error.message}`);
  await admin.from('athlete_vitals').delete().eq('profile_id', alpha.id).in('metric_key', ['height', 'weight']).gte('created_at', startedAt);
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

test('the sign-up details are in Edit Profile, pre-filled, and a nickname leads the display name @mobile', async ({ page }) => {
  const alpha = loadQaUser('user.json');
  const admin = adminClient();
  const nickname = `Nick${Math.random().toString(36).slice(2, 6)}`;

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Edit Profile Details' }).click();
  // Collected at sign-up; until Sep 30 2026 no screen showed them again.
  await expect(page.locator('#phone')).toHaveValue(SEED.phone, { timeout: 20_000 });
  await expect(page.locator('#postal_code')).toHaveValue(SEED.postal_code);
  await expect(page.getByRole('radio', { name: 'Male', exact: true })).toBeChecked();
  await expect(page.locator('#nickname')).toHaveValue('');

  await page.locator('#nickname').fill(nickname);
  await page.locator('#phone').fill('647-555-0199');
  await page.getByRole('radio', { name: 'Not set', exact: true }).check();
  await page.getByRole('button', { name: 'Save Basic' }).click();
  await expect(page.locator('#nickname')).toBeHidden({ timeout: 20_000 });

  const res = await page.request.get(`/api/profile?id=${alpha.id}`);
  expect(res.status(), await res.text()).toBe(200);
  const body = await res.json();
  expect(body.profile).toMatchObject({
    nickname,
    phone: '647-555-0199',
    gender: null,
    postal_code: SEED.postal_code,
    // Signup's rule, kept current by the server: the nickname leads.
    display_name: nickname,
    full_name: `${prior!.first_name} ${prior!.last_name}`,
  });

  // A stored value the column refuses is a 400 naming the field — never a 500.
  const bad = await page.request.put('/api/profile', { data: { profileData: { gender: 'other' }, userId: alpha.id } });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error).toBe('Gender must be Female, Male or Custom');

  // Back to the seed for the tests that follow.
  const { error } = await admin
    .from('profiles')
    .update({ nickname: null, phone: SEED.phone, gender: SEED.gender, full_name: prior!.full_name, display_name: prior!.display_name })
    .eq('id', alpha.id);
  expect(error).toBeNull();
});

test('a height changed in Edit Profile lands on the Vitals timeline; an untouched one adds nothing @mobile', async ({ page }) => {
  const alpha = loadQaUser('user.json');
  const admin = adminClient();
  const t0 = new Date().toISOString();
  const entries = async () =>
    (
      await admin
        .from('athlete_vitals')
        .select('metric_key, value_display')
        .eq('profile_id', alpha.id)
        .in('metric_key', ['height', 'weight'])
        .gte('created_at', t0)
    ).data ?? [];
  const classYear = async () => (await admin.from('profiles').select('class_year').eq('id', alpha.id).single()).data?.class_year;

  // 1. Save the Vitals tab WITHOUT touching height or weight: no entry, and
  //    the stored height is not rewritten through a ft-in → cm round trip.
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Edit Profile Details' }).click();
  await tab(page, 'Vitals').click();
  await expect(page.locator('#height')).toHaveValue(`5'11"`, { timeout: 20_000 });
  await page.locator('#class_year').fill('2032');
  await page.getByRole('button', { name: 'Save Vitals' }).click();
  await expect.poll(classYear, { timeout: 20_000 }).toBe(2032);
  await expect(page.locator('#height')).toBeHidden({ timeout: 15_000 });
  expect(await entries()).toEqual([]);
  expect((await admin.from('profiles').select('height_cm').eq('id', alpha.id).single()).data?.height_cm).toBe(SEED.height_cm);

  // 2. Change the height: one timeline entry, and the profile follows.
  await page.getByRole('button', { name: 'Edit Profile Details' }).click();
  await tab(page, 'Vitals').click();
  await expect(page.locator('#height')).toHaveValue(`5'11"`);
  await page.locator('#height').fill(`6'1"`);
  await page.getByRole('button', { name: 'Save Vitals' }).click();
  await expect.poll(async () => (await entries()).length, { timeout: 20_000 }).toBe(1);
  expect(await entries()).toEqual([{ metric_key: 'height', value_display: `6'1"` }]);
  await expect(page.locator('#height')).toBeHidden({ timeout: 15_000 });
  expect((await admin.from('profiles').select('height_cm').eq('id', alpha.id).single()).data?.height_cm).toBe(185);

  // 3. Reopen and save again untouched: still one entry.
  await page.getByRole('button', { name: 'Edit Profile Details' }).click();
  await tab(page, 'Vitals').click();
  await expect(page.locator('#height')).toHaveValue(`6'1"`);
  await page.locator('#class_year').fill('2033');
  await page.getByRole('button', { name: 'Save Vitals' }).click();
  await expect.poll(classYear, { timeout: 20_000 }).toBe(2033);
  expect(await entries()).toHaveLength(1);

  // Back to the seed.
  const { error } = await admin
    .from('profiles')
    .update({ height_cm: SEED.height_cm, class_year: SEED.class_year })
    .eq('id', alpha.id);
  expect(error).toBeNull();
});

// ── Part 4 (Oct 2 2026): Edit Profile opens where you are ────────────────────
// The header's entry used to open the editor on three pages only (the ones
// that mounted it) and NAVIGATE to /athlete everywhere else — a second tap
// was needed there. The editor is mounted once at the app root now
// (EditProfileHost) and opens over the page the user is on.

const editDialog = (page: Page) => page.getByRole('dialog', { name: 'Edit Profile', exact: true });

test('the account menu opens Edit Profile over the page you are on — no trip to the profile page', async ({ page }) => {
  const alpha = loadQaUser('user.json');

  // Two pages whose header never had an editor of its own.
  for (const path of ['/calendar', '/sports/explore']) {
    await page.goto(path);
    await page.locator('[data-profile-menu-trigger]').click();
    await page.getByRole('button', { name: 'Edit Profile', exact: true }).click();
    await expect(editDialog(page)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#first_name')).toHaveValue(String(prior!.first_name), { timeout: 20_000 });
    await expect(page.locator('#bio')).toHaveValue(SEED.bio);
    expect(new URL(page.url()).pathname, 'the editor opens in place').toBe(path);

    // Closing leaves you where you were.
    await page.getByRole('button', { name: 'Close modal' }).click();
    await expect(editDialog(page)).toBeHidden();
    expect(new URL(page.url()).pathname).toBe(path);
  }

  // A save from another page: the editor closes, you stay, the change is real.
  const newBio = `Edited from Settings ${Math.random().toString(36).slice(2, 8)}`;
  try {
    await page.goto('/settings?tab=appearance');
    await page.locator('[data-profile-menu-trigger]').click();
    await page.getByRole('button', { name: 'Edit Profile', exact: true }).click();
    await expect(page.locator('#bio')).toHaveValue(SEED.bio, { timeout: 20_000 });
    await page.locator('#bio').fill(newBio);
    await page.getByRole('button', { name: 'Save Basic' }).click();
    await expect(editDialog(page)).toBeHidden({ timeout: 20_000 });
    expect(page.url()).toContain('/settings?tab=appearance');
    await expect(page.getByRole('heading', { name: 'Theme' })).toBeVisible();
    const res = await page.request.get(`/api/profile?id=${alpha.id}`);
    expect((await res.json()).profile.bio).toBe(newBio);
  } finally {
    await adminClient().from('profiles').update({ bio: SEED.bio }).eq('id', alpha.id);
  }
});

test('the phone menu opens Edit Profile in place; leaving the page closes it @mobile', async ({ page }) => {
  // A client-side step first, so Back is a route change inside the app (the
  // case a root-mounted pop-up must not survive).
  await page.goto('/feed');
  await page.locator('[data-tab-bar] [data-tab="calendar"]').click();
  await page.waitForURL('**/calendar', { timeout: 20_000 });

  await page.getByRole('button', { name: 'Toggle mobile menu' }).click();
  await page.getByRole('button', { name: 'Edit Profile', exact: true }).click();
  await expect(editDialog(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#first_name')).toHaveValue(String(prior!.first_name), { timeout: 20_000 });
  expect(new URL(page.url()).pathname).toBe('/calendar');
  // Nothing spills sideways at phone width.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // Marked so the assertion below knows Back was a route change INSIDE the
  // app (a full reload would hide any pop-up and prove nothing).
  await page.evaluate(() => { (window as unknown as { __eaSameDocument?: boolean }).__eaSameDocument = true; });
  await page.goBack();
  await page.waitForURL('**/feed', { timeout: 20_000 });
  expect(await page.evaluate(() => (window as unknown as { __eaSameDocument?: boolean }).__eaSameDocument)).toBe(true);
  await expect(editDialog(page)).toBeHidden();
});
