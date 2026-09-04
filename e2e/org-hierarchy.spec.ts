import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// Org staff program, round 5: the console's Hierarchy & people section.
// The OWNER (user B) sees the org → season → division → team tree with the
// people on each node (a seeded division-scoped staff row for user A),
// opens the invite sheet from the division node (the scope is prefilled),
// mints an invite, sees it under Open invites, and revokes A's grant. A
// section-manager (A) sees the tree too — without Invite buttons. Runs in
// the mobile projects (the @mobile tag: Chromium + WebKit at 390×844) — one
// column, no horizontal overflow. Self-skips pre-178.

const rand = () => Math.random().toString(36).slice(2, 8);

test('hierarchy: tree + people + invite from a node + revoke; section staff see it read-only @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const probe = await admin.from('org_staff_invites').select('id').limit(1);
  test.skip(!!probe.error, 'migration 178 not applied');

  const a = loadQaUser('user.json');
  const owner = loadQaUser('user-b.json');
  const name = `QA Hierarchy League ${rand()}`;
  const { data: league, error: leagueError } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id, approved_at: new Date().toISOString() })
    .select('id')
    .single();
  expect(leagueError, 'league seeded').toBeNull();
  const leagueId = league!.id as string;
  try {
    await admin.from('memberships').insert({ league_id: leagueId, profile_id: owner.id, kind: 'follow', role: 'owner', scope_type: 'org' });
    const season = (await admin.from('seasons').insert({ league_id: leagueId, label: '2026' }).select('id').single()).data!;
    const division = (
      await admin.from('divisions').insert({ league_id: leagueId, season_id: season.id, name: 'U13 Boys', sport_key: 'ice_hockey' }).select('id').single()
    ).data!;
    const team = (await admin.from('teams').insert({ league_id: leagueId, name: 'Rangers' }).select('id').single()).data!;
    await admin.from('teams').insert({ league_id: leagueId, name: 'Free Agents' });
    await admin.from('team_entries').insert({ team_id: team.id, division_id: division.id });
    const staffRow = await admin
      .from('memberships')
      .insert({
        league_id: leagueId, profile_id: a.id, kind: 'staff', role: 'staff', scope_type: 'division', scope_id: division.id,
        sections: ['teams'], granted_by: owner.id, granted_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    expect(staffRow.error, 'staff row seeded').toBeNull();

    // The owner's console: the tree, the people, the invite sheet from the division node.
    const ownerCtx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ownerCtx.newPage();
      await page.goto(`/app/org/league/${leagueId}`);
      const section = page.locator('section#hierarchy');
      await expect(section.getByRole('heading', { name: 'Hierarchy & people' })).toBeVisible({ timeout: 30_000 });
      const width = page.viewportSize()?.width ?? 1280;
      expect(await page.evaluate(() => document.documentElement.scrollWidth), 'no horizontal overflow').toBeLessThanOrEqual(width);
      await expect(section.locator('[data-node="org"]')).toContainText('Owner');
      const divisionNode = section.locator(`[data-node="division:${division.id}"]`);
      await expect(divisionNode).toContainText('U13 Boys');
      await expect(divisionNode).toContainText('Rangers');
      await expect(divisionNode.getByLabel('People on U13 Boys')).toContainText('Teams');
      await expect(section.locator('[data-node="unassigned"]')).toContainText('Free Agents');
      // Invite from the division node: the sheet opens with the scope prefilled.
      await divisionNode.getByRole('button', { name: 'Invite' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Invite to manage sections' });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('#staff-invite-scope')).toHaveValue(`division:${division.id}`);
      await expect(dialog.getByRole('checkbox', { name: /Admin/ })).toHaveCount(0); // admin is org-scope only
      await dialog.locator('#staff-invite-email').fill(`edgeqa-hier-${rand()}@example.com`);
      await dialog.getByRole('checkbox', { name: 'Competitions & schedule' }).check();
      await dialog.getByRole('button', { name: 'Create invite' }).click();
      await expect(dialog.getByLabel('Invite link')).toHaveValue(/\/org-invite\//, { timeout: 20_000 });
      await dialog.getByRole('button', { name: 'Done' }).click();
      await expect(section.getByText('Open invites')).toBeVisible({ timeout: 20_000 });
      await expect(section).toContainText('Competitions & schedule · U13 Boys');
      // Revoke the open invite, then A's grant.
      await section.getByRole('button', { name: 'Revoke' }).first().click();
      await expect(section.getByText('Open invites')).toHaveCount(0, { timeout: 20_000 });
      await divisionNode.getByRole('button', { name: /^Revoke / }).click();
      await expect(divisionNode.getByLabel('People on U13 Boys').locator('li')).toHaveCount(0, { timeout: 20_000 });
      // Every node offers Invite to the owner.
      expect(await section.getByRole('button', { name: 'Invite' }).count()).toBeGreaterThanOrEqual(3);
    } finally {
      await ownerCtx.close();
    }

    // A (re-granted) sees the tree without Invite buttons.
    await admin.from('memberships').insert({
      league_id: leagueId, profile_id: a.id, kind: 'staff', role: 'staff', scope_type: 'org',
      sections: ['teams'], granted_by: owner.id, granted_at: new Date().toISOString(),
    });
    const aCtx = await browser.newContext({ storageState: 'e2e/.auth/state.json' });
    try {
      const page = await aCtx.newPage();
      await page.goto(`/app/org/league/${leagueId}`);
      const section = page.locator('section#hierarchy');
      await expect(section.getByRole('heading', { name: 'Hierarchy & people' })).toBeVisible({ timeout: 30_000 });
      await expect(section.locator('[data-node="org"]')).toContainText('Teams');
      expect(await section.getByRole('button', { name: 'Invite' }).count()).toBe(0);
      await expect(page.getByRole('heading', { name: 'Teams', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Website', exact: true })).toHaveCount(0);
    } finally {
      await aCtx.close();
    }
  } finally {
    await admin.from('org_staff_audit').delete().eq('league_id', leagueId);
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
