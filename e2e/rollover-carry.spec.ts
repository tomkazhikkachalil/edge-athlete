import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, createQaChild, deleteQaUser, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Teams & divisions program, PR 11 (Sep 27 2026): rollover carries a roster
// forward when the manager says so. Blazers (A and D's supervised child)
// and Comets (C) play the closing season. The console's Roll forward form
// offers "Carry roster forward (2 players)" per team. Rolling forward with
// Blazers carried: Blazers' players have spots in the NEW season (the old
// rows stay as history), Comets starts empty, A is told, and D is told
// about the child. @mobile

test('rollover carry-forward: the chosen team carries, the other starts empty; players and guardians told @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const alpha = loadQaUser('user.json');
  const charlie = loadQaUser('user-c.json');
  const delta = loadQaUser('user-d.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-structure', owner.id);
  const stamp = Date.now();
  const name = `QA Carry League ${stamp}`;
  const league = await createQaOrg(admin, 'league', { name, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  const childId = await createQaChild(delta.id, { firstName: 'Robin', handle: `qa_robin_${stamp}` });
  const ownerApi = await apiAs('state-b.json');
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 390, height: 844 } });
  try {
    const { data: season } = await admin.from('seasons').insert({ org_id: league.id, label: `Carry ${stamp}` }).select('id').single();
    const { data: division } = await admin.from('divisions').insert({ org_id: league.id, season_id: season!.id, sport_key: 'ice_hockey', name: `U13 ${stamp}` }).select('id').single();
    const { data: teams } = await admin.from('teams').insert([{ org_id: league.id, name: `Blazers ${stamp}` }, { org_id: league.id, name: `Comets ${stamp}` }]).select('id, name');
    const blazers = teams!.find(t => (t.name as string).startsWith('Blazers'))!.id as string;
    const comets = teams!.find(t => (t.name as string).startsWith('Comets'))!.id as string;
    await admin.from('team_entries').insert([{ team_id: blazers, division_id: division!.id }, { team_id: comets, division_id: division!.id }]);
    const spot = (profileId: string, teamId: string) => ({ org_id: league.id, profile_id: profileId, kind: 'roster', role: 'member', status: 'active', scope_type: 'team', scope_id: teamId, season_id: season!.id });
    const { error: seedError } = await admin.from('memberships').insert([
      { org_id: league.id, profile_id: owner.id, kind: 'follow', role: 'owner', status: 'active', scope_type: 'org', scope_id: null, season_id: null },
      spot(alpha.id, blazers),
      spot(childId, blazers),
      spot(charlie.id, comets),
    ]);
    expect(seedError, seedError?.message).toBeNull();

    // The console form offers the carry per team, with its count.
    const page = await ctx.newPage();
    await page.goto(`/app/org/league/${league.id}`);
    await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Roll forward' }).first().click();
    const picker = page.locator('[data-rollover-carry]');
    await expect(picker).toContainText(`Blazers ${stamp} — carry roster forward (2 players)`, { timeout: 20_000 });
    await expect(picker.getByLabel(`Carry Blazers ${stamp}'s roster forward`)).not.toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    // Roll forward carrying Blazers only.
    const res = await ownerApi.post(`/api/leagues/${league.id}/structure/rollover`, {
      data: { seasonId: season!.id, label: `Next ${stamp}`, carryRosterTeamIds: [blazers] },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const body = await res.json();
    expect(body.cloned.rosterRowsCarried).toBe(2);
    const newSeasonId = body.season.id as string;

    const spots = async (seasonId: string) =>
      ((await admin.from('memberships').select('profile_id, scope_id').eq('org_id', league.id).eq('kind', 'roster').eq('scope_type', 'team').eq('season_id', seasonId)).data ?? [])
        .map(r => `${r.profile_id}:${r.scope_id}`)
        .sort();
    expect(await spots(newSeasonId)).toEqual([`${alpha.id}:${blazers}`, `${childId}:${blazers}`].sort());
    expect(await spots(season!.id)).toHaveLength(3); // last season's rows stay as history

    // The bells: A, and D about the child.
    const bell = async (userId: string) => (await admin.from('notifications').select('title, metadata').eq('user_id', userId).eq('type', 'team_roster')).data ?? [];
    expect((await bell(alpha.id)).some(b => (b.metadata as { team_roster?: string }).team_roster === 'carried' && b.title.includes(`Next ${stamp}`))).toBe(true);
    expect((await bell(delta.id)).some(b => b.title.startsWith('Robin is on') && (b.metadata as { profile_id?: string }).profile_id === childId)).toBe(true);
    expect((await bell(charlie.id)).some(b => (b.metadata as { team_roster?: string }).team_roster === 'carried')).toBe(false);
  } finally {
    await ctx.close();
    await ownerApi.dispose();
    await deleteQaOrgs(admin, [league.id]);
    await deleteQaUser(childId);
  }
});
