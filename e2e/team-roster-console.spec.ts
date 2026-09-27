import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Teams & divisions program, PR 5 (Sep 27 2026): the console's team roster
// panel at phone width. The owner opens a team's Roster, adds a rostered
// member from the candidates, moves them to the other team, takes them off
// (confirmed), and invites a member who is not on the roster yet (the org
// roster offer — the add opens once they accept). No sideways scroll. @mobile

test('team roster console: add, move, remove (confirmed), invite a non-rostered member; 390px @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const alpha = loadQaUser('user.json');
  const charlie = loadQaUser('user-c.json');
  const admin = adminClient();
  const probe = await admin.from('teams').select('sport_key').limit(1);
  test.skip(!!probe.error, `teams.sport_key missing — run migration 242 (${probe.error?.message})`);
  await resetRateBucket(admin, 'org-structure', owner.id);
  await resetRateBucket(admin, 'roster-offer', owner.id);

  const stamp = Date.now();
  const name = `QA Roster Console ${stamp}`;
  const club = await createQaOrg(admin, 'club', { name, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  const ownerApi = await apiAs('state-b.json');
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 390, height: 844 } });
  try {
    await admin.from('seasons').insert({ org_id: club.id, label: `Console ${stamp}` });
    await admin.from('teams').insert([{ org_id: club.id, name: `Blazers ${stamp}` }, { org_id: club.id, name: `Comets ${stamp}` }]);
    const { data: teams } = await admin.from('teams').select('id, name').eq('org_id', club.id);
    const blazers = teams!.find(t => (t.name as string).startsWith('Blazers'))!;
    const comets = teams!.find(t => (t.name as string).startsWith('Comets'))!;
    await admin.from('memberships').insert([
      { org_id: club.id, profile_id: owner.id, kind: 'follow', role: 'owner', status: 'active' },
      { org_id: club.id, profile_id: alpha.id, kind: 'follow', role: 'member', status: 'active' },
      { org_id: club.id, profile_id: alpha.id, kind: 'roster', role: 'member', status: 'active' },
      { org_id: club.id, profile_id: charlie.id, kind: 'follow', role: 'member', status: 'active' },
    ]);
    // The names the panel shows (the candidates' display names).
    const view = await ownerApi.get(`/api/clubs/${club.id}/teams/${blazers.id}/roster?candidates=1`);
    expect(view.status(), await readErrorBody(view)).toBe(200);
    const cands = (await view.json()).candidates as { profileId: string; name: string }[];
    const alphaName = cands.find(c => c.profileId === alpha.id)!.name;

    const page = await ctx.newPage();
    await page.goto(`/app/org/club/${club.id}`);
    await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 30_000 });
    const section = page.getByRole('region', { name: 'Teams' });
    const blazersRow = section.locator('li').filter({ hasText: blazers.name as string }).first();
    await blazersRow.getByRole('button', { name: 'Roster', exact: true }).click();
    const panel = page.locator(`[data-team-roster="${blazers.id}"]`);
    await expect(panel.getByText('No one on this team yet.')).toBeVisible({ timeout: 20_000 });

    // Add alpha (on the org roster).
    await panel.getByRole('button', { name: `Add ${alphaName} to ${blazers.name}` }).click();
    await expect(panel.locator(`[data-team-roster-player="${alpha.id}"]`)).toBeVisible({ timeout: 20_000 });

    // Charlie is not on the roster: invite, and the offer is pending.
    const charlieRow = panel.locator(`[data-team-roster-needs-invite="${charlie.id}"]`);
    await expect(charlieRow).toContainText('Not on your roster yet');
    await charlieRow.getByRole('button', { name: 'Invite to roster' }).click();
    await expect(charlieRow).toContainText('Invited', { timeout: 20_000 });
    await expect
      .poll(async () => (await admin.from('memberships').select('status').eq('org_id', club.id).eq('profile_id', charlie.id).eq('kind', 'roster').maybeSingle()).data?.status, { timeout: 15_000 })
      .toBe('pending');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    // Move alpha to Comets.
    await panel.getByLabel(`Move ${alphaName} to`).selectOption(comets.id as string);
    await panel.getByRole('button', { name: 'Move', exact: true }).click();
    await expect(panel.getByText('No one on this team yet.')).toBeVisible({ timeout: 20_000 });
    const { data: moved } = await admin.from('memberships').select('scope_id').eq('profile_id', alpha.id).eq('scope_type', 'team');
    expect(moved).toEqual([{ scope_id: comets.id }]);

    // Open Comets and take alpha off — confirmed.
    const cometsRow = section.locator('li').filter({ hasText: comets.name as string }).first();
    await cometsRow.getByRole('button', { name: 'Roster', exact: true }).click();
    const cometsPanel = page.locator(`[data-team-roster="${comets.id}"]`);
    await cometsPanel.getByRole('button', { name: `Remove ${alphaName} from ${comets.name}` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(`Take ${alphaName} off ${comets.name}?`);
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(cometsPanel.getByText('No one on this team yet.')).toBeVisible({ timeout: 20_000 });
    expect((await admin.from('memberships').select('id').eq('profile_id', alpha.id).eq('scope_type', 'team')).data).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  } finally {
    await ctx.close();
    await ownerApi.dispose();
    await deleteQaOrgs(admin, [club.id]);
  }
});
