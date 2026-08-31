import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// Roster import (phase 1 R3): the owner pastes two athletes into a team
// from the console → two claimable stub profiles with THREE membership
// rows each (org follow, org roster active, TEAM roster active — the
// first sub-org rows) + claim links; the public page shows Unclaimed
// chips to the manager and hides them from anonymous viewers.
test('roster import: paste two athletes → stubs + 3 rows each + claim links; chips redacted', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('athlete_claim_invites').select('id').limit(1);
  test.skip(!!probe.error, `athlete_claim_invites missing — run migration 150 (${probe.error?.message})`);

  const stamp = Date.now();
  const name = `QA Import League ${stamp}`;
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert([{ league_id: leagueId, profile_id: owner.id, role: 'owner' }]);
  const { data: team } = await admin
    .from('teams')
    .insert({ league_id: leagueId, name: `Blazers ${stamp}` })
    .select()
    .single();
  const teamId = team!.id as string;

  const stubIds: string[] = [];
  try {
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ctx.newPage();
      await page.goto(`/app/org/league/${leagueId}`);
      await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 20_000 });

      await page.getByRole('button', { name: 'Import roster' }).click();
      await page
        .getByLabel('Roster import lines')
        .fill('Rory Marchand\nMaya Chen, maya.chen@example.com');
      await page.getByRole('button', { name: 'Import', exact: true }).click();
      await expect(page.getByText('Rory Marchand')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByLabel('Claim link for Rory Marchand')).toBeVisible();
      await expect(page.getByLabel('Claim link for Maya Chen')).toBeVisible();

      // 375px: the expander + result list stay usable.
      await page.setViewportSize({ width: 375, height: 812 });
      await expect(page.getByLabel('Claim link for Maya Chen')).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    } finally {
      await ctx.close();
    }

    // DB truth: stubs on @stubs.invalid, supervised self rows, 3 rows each.
    const { data: stubs } = await admin
      .from('profiles')
      .select('id, email, first_name, visibility, supervision_state')
      .like('email', '%@stubs.invalid')
      .in('first_name', ['Rory', 'Maya']);
    expect(stubs).toHaveLength(2);
    for (const stub of stubs!) {
      stubIds.push(stub.id as string);
      expect(stub.visibility).toBe('private');
      expect(stub.supervision_state).toBe('supervised');
      const { data: access } = await admin
        .from('profile_access')
        .select('role, user_id')
        .eq('profile_id', stub.id);
      expect(access).toEqual([{ role: 'supervised', user_id: stub.id }]);
      const { data: rows } = await admin
        .from('memberships')
        .select('kind, status, scope_type, scope_id')
        .eq('league_id', leagueId)
        .eq('profile_id', stub.id)
        .order('kind');
      expect(rows).toEqual([
        { kind: 'follow', status: 'active', scope_type: 'org', scope_id: null },
        { kind: 'roster', status: 'active', scope_type: 'org', scope_id: null },
        { kind: 'roster', status: 'active', scope_type: 'team', scope_id: teamId },
      ]);
      const { data: invites } = await admin
        .from('athlete_claim_invites')
        .select('id, team_id')
        .eq('profile_id', stub.id);
      expect(invites).toHaveLength(1);
      expect(invites![0].team_id).toBe(teamId);
    }

    // Chips: manager sees Unclaimed; anonymous viewer does not (redaction).
    const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const pageB = await ctxB.newPage();
      await pageB.goto(`/league/${leagueId}`);
      await expect(pageB.getByText('Unclaimed').first()).toBeVisible({ timeout: 20_000 });
    } finally {
      await ctxB.close();
    }
    const ctxAnon = await browser.newContext();
    try {
      const pageAnon = await ctxAnon.newPage();
      await pageAnon.goto(`/league/${leagueId}`);
      await expect(pageAnon.getByRole('heading', { name })).toBeVisible({ timeout: 20_000 });
      await expect(pageAnon.getByText('Unclaimed')).toHaveCount(0);
    } finally {
      await ctxAnon.close();
    }
  } finally {
    // Org delete cascades ALL memberships (team rows carry the org pair);
    // stub profiles cascade their invites; shadow users go explicitly —
    // deleteQaUser knows nothing about stubs.
    await admin.from('leagues').delete().eq('id', leagueId);
    for (const id of stubIds) {
      await admin.from('profiles').delete().eq('id', id);
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  }
});
