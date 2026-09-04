import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Org staff program, round 4: the invite loop. The OWNER (user B) invites
// user A's email to manage Teams inside one division; A accepts on the
// landing page (375px); A's capabilities carry the scoped grant; the
// route-family intents of round 3 hold the line (structure GET 200, an
// entry in THAT division allowed, a season 403, the org's settings 403);
// the owner's staff list shows A; revoke empties A's capabilities and the
// wrong-account precondition keeps a token intact. Self-skips pre-178.

const rand = () => Math.random().toString(36).slice(2, 8);

test('staff invite: owner mints → A accepts at 375px → scoped grant honoured → revoke', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const probe = await admin.from('org_staff_invites').select('id').limit(1);
  test.skip(!!probe.error, 'migration 178 not applied');

  const a = loadQaUser('user.json');
  const owner = loadQaUser('user-b.json');
  const name = `QA Staff League ${rand()}`;
  const { data: league, error: leagueError } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id, approved_at: new Date().toISOString() })
    .select('id')
    .single();
  expect(leagueError, 'league seeded').toBeNull();
  const leagueId = league!.id as string;
  const ownerApi = await apiAs('state-b.json');
  const aApi = await apiAs('state.json');
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    await admin.from('memberships').insert({ league_id: leagueId, profile_id: owner.id, kind: 'follow', role: 'owner', scope_type: 'org' });
    const seeded = await admin.from('seasons').insert({ league_id: leagueId, label: '2026' }).select('id').single();
    expect(seeded.error, 'season seeded').toBeNull();
    const season = seeded.data!;
    const div1 = await admin
      .from('divisions')
      .insert({ league_id: leagueId, season_id: season.id, name: 'U13 Boys', sport_key: 'ice_hockey' })
      .select('id')
      .single();
    expect(div1.error, 'division seeded').toBeNull();
    const division = div1.data!;
    const div2 = await admin
      .from('divisions')
      .insert({ league_id: leagueId, season_id: season.id, name: 'U15 Girls', sport_key: 'ice_hockey' })
      .select('id')
      .single();
    expect(div2.error, 'second division seeded').toBeNull();
    const otherDivision = div2.data!;
    const t1 = await admin.from('teams').insert({ league_id: leagueId, name: 'Rangers' }).select('id').single();
    const t2 = await admin.from('teams').insert({ league_id: leagueId, name: 'Hawks' }).select('id').single();
    expect(t1.error ?? t2.error, 'teams seeded').toBeNull();
    const team = t1.data!;
    const team2 = t2.data!;

    // A non-owner (A, a stranger) cannot mint; the owner can.
    const denied = await aApi.post(`/api/leagues/${leagueId}/staff`, { data: { email: a.email, grant: { role: 'staff', sections: ['teams'] } } });
    expect(denied.status(), await readErrorBody(denied)).toBe(403);
    const minted = await ownerApi.post(`/api/leagues/${leagueId}/staff`, {
      data: { email: a.email.toUpperCase(), grant: { role: 'staff', sections: ['teams'], scopeType: 'division', scopeId: division.id } },
    });
    expect(minted.status(), await readErrorBody(minted)).toBe(201);
    const mintedBody = await minted.json();
    expect(mintedBody.inviteUrl).toContain('/org-invite/');
    expect(mintedBody.summary).toBe('Teams');
    const token = String(mintedBody.inviteUrl).split('/org-invite/')[1];

    // A foreign division is refused.
    const foreign = await ownerApi.post(`/api/leagues/${leagueId}/staff`, {
      data: { email: a.email, grant: { role: 'staff', sections: ['teams'], scopeType: 'division', scopeId: '00000000-0000-4000-8000-000000000000' } },
    });
    expect(foreign.status()).toBe(400);

    // The open invite is listed for the owner (email visible to the owner only).
    const listed = await (await ownerApi.get(`/api/leagues/${leagueId}/staff`)).json();
    expect(listed.invites.map((i: { invitedEmail: string }) => i.invitedEmail)).toContain(a.email.toLowerCase());

    // Wrong account: the OWNER tries to accept A's invite → 403, token intact.
    const wrong = await ownerApi.post(`/api/org-invite/${token}`);
    expect(wrong.status()).toBe(403);
    expect((await wrong.json()).wrongAccount).toBe(true);
    const anonPeek = await (await anon.newPage()).request.get(`/api/org-invite/${token}`);
    expect(anonPeek.status()).toBe(200);
    expect((await anonPeek.json()).summary).toBe('Teams');

    // A accepts on the landing page at phone width.
    const aCtx = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport: { width: 375, height: 812 } });
    try {
      const page = await aCtx.newPage();
      await page.goto(`/org-invite/${token}`);
      await expect(page.getByRole('heading', { name: `Help run ${name}` })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('Division: U13 Boys')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
      await page.getByRole('button', { name: 'Accept the invite' }).click();
      await expect(page.getByRole('heading', { name: `You're on ${name}'s staff` })).toBeVisible({ timeout: 20_000 });
      await page.getByRole('link', { name: /Open the console/ }).click();
      await page.waitForURL(new RegExp(`/app/org/league/${leagueId}`), { timeout: 20_000 });
      // The console opens for a section manager and shows only Teams.
      await expect(page.getByRole('heading', { name: 'Teams', exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('heading', { name: 'Seasons', exact: true })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Website', exact: true })).toHaveCount(0);
    } finally {
      await aCtx.close();
    }

    // Second accept: the token is spent.
    expect((await aApi.post(`/api/org-invite/${token}`)).status()).toBe(410);

    // Capabilities carry the scoped grant; the route matrix holds.
    const caps = await (await aApi.get(`/api/leagues/${leagueId}/capabilities`)).json();
    expect(caps.canEnterConsole).toBe(true);
    expect(caps.scoped).toEqual([{ scopeType: 'division', scopeId: division.id, sections: ['teams'] }]);
    expect((await aApi.get(`/api/leagues/${leagueId}/structure`)).status()).toBe(200);
    const entryOk = await aApi.post(`/api/leagues/${leagueId}/structure/entries`, { data: { teamId: team.id, divisionId: division.id } });
    expect(entryOk.status(), await readErrorBody(entryOk)).toBe(200);
    const entryDenied = await aApi.post(`/api/leagues/${leagueId}/structure/entries`, { data: { teamId: team2.id, divisionId: otherDivision.id } });
    expect(entryDenied.status()).toBe(403);
    const teamDenied = await aApi.post(`/api/leagues/${leagueId}/structure/teams`, { data: { side: 'league', orgId: leagueId, name: 'Nope' } });
    expect(teamDenied.status()).toBe(403); // org-level write, division grant only
    expect((await aApi.post(`/api/leagues/${leagueId}/structure/seasons`, { data: { side: 'league', orgId: leagueId, label: 'Nope' } })).status()).toBe(403);
    expect((await aApi.patch(`/api/leagues/${leagueId}`, { data: { name: 'Renamed' } })).status()).toBe(403);
    expect((await aApi.get(`/api/leagues/${leagueId}/site`)).status()).toBe(403);

    // The owner's staff list shows A with the grant; A cannot change grants; the owner revokes.
    const staff = await (await ownerApi.get(`/api/leagues/${leagueId}/staff`)).json();
    const aRow = staff.staff.find((s: { profileId: string }) => s.profileId === a.id);
    expect(aRow).toMatchObject({ role: 'staff', sections: ['teams'], scopeType: 'division', scopeId: division.id });
    expect((await aApi.delete(`/api/leagues/${leagueId}/staff/${aRow.rowId}`)).status()).toBe(403);
    const changed = await ownerApi.patch(`/api/leagues/${leagueId}/staff/${aRow.rowId}`, { data: { sections: ['teams', 'venues'] } });
    expect(changed.status(), await readErrorBody(changed)).toBe(200);
    expect((await (await aApi.get(`/api/leagues/${leagueId}/capabilities`)).json()).scoped[0].sections).toEqual(['teams', 'venues']);
    expect((await ownerApi.delete(`/api/leagues/${leagueId}/staff/${aRow.rowId}`)).status()).toBe(200);
    const after = await (await aApi.get(`/api/leagues/${leagueId}/capabilities`)).json();
    expect(after.canEnterConsole).toBe(false);
    expect((await aApi.get(`/api/leagues/${leagueId}/structure`)).status()).toBe(403);

    // The audit trail has the whole story.
    const { data: audit } = await admin.from('org_staff_audit').select('action').eq('league_id', leagueId).order('created_at');
    expect((audit ?? []).map(r => r.action)).toEqual(['invited', 'accepted', 'changed', 'revoked']);
  } finally {
    await ownerApi.dispose();
    await aApi.dispose();
    await anon.close();
    await admin.from('org_staff_audit').delete().eq('league_id', leagueId);
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
