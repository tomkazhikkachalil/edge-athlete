import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// The org-manager console (phase 1, round 1): the owner drives the full
// structure lifecycle through /app/org/league/[id] — season → division →
// team → entry → archive/restore — while a plain member gets the
// managers-only state and a 403 from the manager API. This is the first
// e2e-able structure CRUD (the admin console needs unmintable ADMIN_EMAILS).
test('org console: owner builds structure via UI; member locked out; 375px', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const member = loadQaUser('user.json');
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('seasons').select('id').limit(1);
  test.skip(!!probe.error, `seasons missing — run migration 145 (${probe.error?.message})`);

  const stamp = Date.now();
  const name = `QA Console League ${stamp}`;
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert([
    { league_id: leagueId, profile_id: owner.id, role: 'owner' },
    { league_id: leagueId, profile_id: member.id, role: 'member' },
  ]);
  const consoleUrl = `/app/org/league/${leagueId}`;

  try {
    // Owner: the full lifecycle through the console UI.
    const ctxOwner = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ctxOwner.newPage();
      await page.goto(consoleUrl);
      await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 20_000 });
      // The setup checklist shows while steps remain.
      await expect(page.getByText('Get set up', { exact: false })).toBeVisible();

      // Season
      await page.getByLabel('Season label').fill('2026-27');
      await page.getByLabel('Season starts').fill('2026-09-01');
      await page.getByLabel('Season ends').fill('2027-04-30');
      await page.getByRole('button', { name: 'Add season' }).click();
      await expect(page.getByText('2026-27', { exact: true })).toBeVisible();

      // Division (expand the season first)
      await page.getByRole('button', { name: 'Divisions' }).click();
      await page.getByLabel('Division name').fill('U13 Boys A');
      await page.getByRole('button', { name: 'Add division' }).click();
      await expect(page.getByText('U13 Boys A')).toBeVisible();

      // Team — scope to the Teams section (the name also appears as an
      // option in the entry select; the exact-match chip lesson).
      await page.getByLabel('Team name').fill('Blazers U13 A');
      await page.getByRole('button', { name: 'Add team' }).click();
      await expect(
        page.getByLabel('Teams').getByText('Blazers U13 A', { exact: true })
      ).toBeVisible();

      // Entry via the per-division select → the chip in the divisions section.
      await page.getByLabel('Enter a team in U13 Boys A').selectOption({ label: 'Blazers U13 A' });
      await expect(
        page.locator('span.rounded-full').filter({ hasText: 'Blazers U13 A' })
      ).toBeVisible();

      // Archive → Restore
      await page.getByRole('button', { name: 'Archive' }).click();
      await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
      await page.getByRole('button', { name: 'Restore' }).click();
      await expect(page.getByRole('button', { name: 'Archive' })).toBeVisible();

      // 375px: no horizontal scroll, the create form still reachable.
      await page.setViewportSize({ width: 375, height: 812 });
      await expect(page.getByRole('button', { name: 'Add season' })).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    } finally {
      await ctxOwner.close();
    }

    // Member: managers-only state in the UI, 403 at the API.
    const ctxMember = await browser.newContext({ storageState: 'e2e/.auth/state.json' });
    try {
      const page = await ctxMember.newPage();
      await page.goto(consoleUrl);
      await expect(page.getByText('Managers only')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('button', { name: 'Add season' })).toHaveCount(0);
    } finally {
      await ctxMember.close();
    }
    const apiMember = await apiAs('state.json');
    try {
      const res = await apiMember.post(`/api/leagues/${leagueId}/structure/seasons`, {
        data: { side: 'league', orgId: leagueId, label: 'Nope' },
      });
      expect(res.status(), await readErrorBody(res)).toBe(403);
    } finally {
      await apiMember.dispose();
    }
  } finally {
    // League delete cascades seasons/divisions/teams/entries (145) +
    // memberships (140).
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
