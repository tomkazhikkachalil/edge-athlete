import { test, expect } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody, adminClient } from './helpers/qa-user';

// The achievements trophy case round-trip: seed a spread (podiums, a
// non-podium, and the "1st Team All-State" honor-guard trap) via the API,
// then assert the hero math, the auto-picked Top Finishes, year grouping,
// filtering (hero stays all-time), the add→edit→delete round trip, the
// real-achievement header pills, the visitor's read-only view, and the
// public /u/ page (where the fabricated sample badges used to live).
test('achievements: seed → hero → showcase → timeline → CRUD → visitor → /u', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const userA = loadQaUser('user.json');
  const stamp = Date.now();

  const seed = [
    { title: `State Amateur ${stamp}`, sportKey: 'golf', achievedOn: '2024-06-15', organization: 'CIF', placement: '1st Place' },
    { title: `Junior Tour Finals ${stamp}`, sportKey: 'golf', achievedOn: '2025-08-10', organization: 'CIF', placement: 'Runner-Up' },
    { title: `Scholar Athlete ${stamp}`, sportKey: null, achievedOn: '2023-05-20', organization: 'State Athletic Board', placement: 'Honorable Mention' },
    // The trap: rank words inside an honor — must NOT count as a podium.
    { title: `All-State Team ${stamp}`, sportKey: 'golf', achievedOn: '2025-11-01', organization: 'CIF', placement: '1st Team All-State' },
  ];

  const api = await apiAs('state.json');
  try {
    for (const body of seed) {
      const res = await api.post('/api/achievements', { data: body });
      expect(res.ok(), await readErrorBody(res)).toBe(true);
    }
  } finally {
    await api.dispose();
  }

  await page.goto('/athlete');

  // Header pills read real achievements — podium-first, so the gold leads.
  await expect(
    page.getByRole('list', { name: 'Achievements' }).getByText(`State Amateur ${stamp}`)
  ).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: /achievements/i }).first().click();

  // Hero math: 4 total, 2 podiums (the All-State trap excluded), 2 orgs, 3 years.
  await expect(page.getByText('Podium finishes')).toBeVisible({ timeout: 15_000 });
  const heroValue = (label: string) =>
    page.locator('div.text-center', { hasText: label }).locator('span.text-2xl').first();
  await expect(heroValue('Achievements')).toHaveText('4');
  await expect(heroValue('Podium finishes')).toHaveText('2');
  await expect(heroValue('Organizations')).toHaveText('2');
  await expect(heroValue('Years active')).toHaveText('3');

  // Top Finishes: gold + silver present, the honor-guard trap absent.
  const showcase = page.getByRole('region', { name: 'Top finishes' });
  await expect(showcase.getByText(`State Amateur ${stamp}`)).toBeVisible();
  await expect(showcase.getByText(`Junior Tour Finals ${stamp}`)).toBeVisible();
  await expect(showcase.getByText(`All-State Team ${stamp}`)).toHaveCount(0);

  // Year grouping, newest first.
  const yearHeaders = page.locator('h4', { hasText: /^\s*20\d\d/ });
  await expect(yearHeaders.nth(0)).toContainText('2025');
  await expect(yearHeaders.nth(1)).toContainText('2024');
  await expect(yearHeaders.nth(2)).toContainText('2023');

  // Filter to 2025 → 2 shown, hero still all-time.
  await page.getByRole('button', { name: /All Years/ }).click();
  await page.getByRole('option', { name: '2025' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByText('2 achievements', { exact: false }).first()).toBeVisible();
  await expect(heroValue('Achievements')).toHaveText('4');
  await page.getByRole('button', { name: 'Clear all filters' }).click();

  // Add → edit → delete round trip through the modal. The modal's submit
  // shares its name with the FilterBar opener — scope to the form.
  await page.getByRole('button', { name: 'Add Achievement' }).click();
  await page.getByLabel(/Title/).fill(`Spring Invite ${stamp}`);
  await page.getByLabel(/Date/).fill('2026-03-22');
  await page.getByLabel(/Placement/).fill('T-3');
  await page.locator('form').getByRole('button', { name: 'Add Achievement' }).click();
  await expect(page.getByText(`Spring Invite ${stamp}`).first()).toBeVisible({ timeout: 10_000 });
  await expect(heroValue('Achievements')).toHaveText('5');

  await page.getByRole('button', { name: `Edit Spring Invite ${stamp}` }).click();
  await page.getByLabel(/Placement/).fill('2nd Place');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('2nd Place').first()).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: `Delete Spring Invite ${stamp}` }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText(`Spring Invite ${stamp}`)).toHaveCount(0, { timeout: 10_000 });
  await expect(heroValue('Achievements')).toHaveText('4');

  // Visitor (user B): read-only trophy case with the same numbers.
  await adminClient().from('profiles').update({ visibility: 'public' }).eq('id', userA.id);
  const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
  try {
    const pageB = await ctxB.newPage();
    await pageB.goto(`/athlete/${userA.id}`);
    await pageB.getByRole('button', { name: /achievements/i }).first().click();
    await expect(pageB.getByText('Podium finishes')).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByText(`State Amateur ${stamp}`).first()).toBeVisible();
    await expect(pageB.getByRole('button', { name: 'Add Achievement' })).toHaveCount(0);
    await expect(pageB.getByRole('button', { name: `Edit State Amateur ${stamp}` })).toHaveCount(0);
  } finally {
    await ctxB.close();
  }

  // Public /u/ page: real titles, and the fabricated sample badges extinct.
  // QA users are created without a handle — mint one (unique per run; the
  // row dies with the user in teardown).
  const handle = `edgeqa${stamp}`;
  const { error: handleError } = await adminClient()
    .from('profiles').update({ handle }).eq('id', userA.id);
  expect(handleError).toBeNull();
  const ctxAnon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const pageU = await ctxAnon.newPage();
    await pageU.goto(`/u/${handle}`);
    await expect(pageU.getByText(`State Amateur ${stamp}`)).toBeVisible({ timeout: 15_000 });
    await expect(pageU.getByText('NCAA D1 Scholar Athlete')).toHaveCount(0);
    await expect(pageU.getByText('Big Ten Championship')).toHaveCount(0);
  } finally {
    await ctxAnon.close();
  }
});
