import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Teams & divisions program, PR 2 (Sep 26 2026): "We run teams" / "We run
// competitions" gate the console. The owner turns teams OFF from "What you
// run" — the Teams section leaves the console, the team itself stays in the
// database — and ON again, and the team is back as it was. A plain member
// can't flip a switch (manage_org). The change lands in the owner's Activity
// (identity_changed). 375px: the card fits, no sideways scroll. @mobile

test('org switches: the owner hides and restores Teams from the console; nothing is deleted; a member is refused @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  const owner = loadQaUser('user-b.json');
  const member = loadQaUser('user.json');
  const admin = adminClient();
  const probe = await admin.from('teams').select('sport_key').limit(1);
  test.skip(!!probe.error, `teams.sport_key missing — run migration 242 (${probe.error?.message})`);

  const stamp = Date.now();
  const name = `QA Switch Club ${stamp}`;
  const club = await createQaOrg(admin, 'club', { name, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  await admin.from('memberships').insert([
    { org_id: club.id, profile_id: owner.id, role: 'owner' },
    { org_id: club.id, profile_id: member.id, role: 'member' },
  ]);
  const teamName = `QA Switch Team ${stamp}`;
  const { data: team, error: teamError } = await admin.from('teams').insert({ org_id: club.id, name: teamName }).select('id').single();
  expect(teamError, teamError?.message).toBeNull();

  const memberApi = await apiAs('state.json');
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 375, height: 812 } });
  try {
    // A member can't flip a switch.
    const refused = await memberApi.patch(`/api/clubs/${club.id}`, { data: { operatesTeams: false } });
    expect(refused.status(), await readErrorBody(refused)).toBe(403);

    const page = await ctx.newPage();
    await page.goto(`/app/org/club/${club.id}`);
    await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 30_000 });
    const teams = page.getByRole('region', { name: 'Teams' });
    await expect(teams).toBeVisible();
    await expect(teams.getByText(teamName)).toBeVisible();

    // Off: the section leaves the console; the note says what is kept.
    const card = page.locator('[data-org-switches]');
    await card.scrollIntoViewIfNeeded();
    const teamsSwitch = card.locator('[data-org-switch="teams"]');
    await expect(teamsSwitch).toBeChecked();
    await teamsSwitch.uncheck();
    await expect(teams).toHaveCount(0, { timeout: 15_000 });
    await expect(card.locator('[data-org-switch-note="teams"]')).toContainText('1 team and their rosters are kept');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

    // The database agrees, and the team is untouched.
    const { data: org } = await admin.from('organizations').select('operates_teams, operates_competitions').eq('id', club.id).single();
    expect(org).toEqual({ operates_teams: false, operates_competitions: true });
    const { data: kept } = await admin.from('teams').select('id, status').eq('id', team!.id).single();
    expect(kept).toEqual({ id: team!.id, status: 'active' });

    // A reload keeps it hidden.
    await page.reload();
    await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('region', { name: 'Teams' })).toHaveCount(0);

    // On again: the section and the team come back as they were.
    await page.locator('[data-org-switch="teams"]').check();
    await expect(page.getByRole('region', { name: 'Teams' }).getByText(teamName)).toBeVisible({ timeout: 15_000 });

    // The owner's Activity records both changes (identity_changed, the switch by name).
    const { data: audit } = await admin
      .from('authority_audit')
      .select('action, detail')
      .eq('subject_id', club.id)
      .eq('action', 'identity_changed');
    const switchRows = (audit ?? []).filter(r => ((r.detail as { fields?: string[] }).fields ?? []).includes('operates_teams'));
    expect(switchRows).toHaveLength(2);
    expect((switchRows.map(r => (r.detail as { after?: { operates_teams?: boolean } }).after?.operates_teams)).sort()).toEqual([false, true]);
  } finally {
    await ctx.close();
    await memberApi.dispose();
    await deleteQaOrgs(admin, [club.id]);
  }
});
