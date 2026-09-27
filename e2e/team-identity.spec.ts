import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Teams & divisions program, PR 6 (Sep 27 2026): a team's identity. The owner
// renames a team, sets its sport and colours from the console (390px), then
// uploads a logo — served anonymously by the team-logo streamer, under the
// team-logos/ prefix the storage sweep protects — and removes it. A duplicate
// name answers 409, a colour that is not #rrggbb answers 400, a plain member
// is refused. @mobile

test('team identity: rename, sport and colours from the console; logo up, served anonymously, removed; refusals by name @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const member = loadQaUser('user.json');
  const admin = adminClient();
  const probe = await admin.from('teams').select('primary_color').limit(1);
  test.skip(!!probe.error, `teams.primary_color missing — run migration 242 (${probe.error?.message})`);
  await resetRateBucket(admin, 'org-structure', owner.id);
  await resetRateBucket(admin, 'upload', owner.id);

  const stamp = Date.now();
  const name = `QA Identity Club ${stamp}`;
  const club = await createQaOrg(admin, 'club', { name, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  await admin.from('memberships').insert([
    { org_id: club.id, profile_id: owner.id, kind: 'follow', role: 'owner', status: 'active' },
    { org_id: club.id, profile_id: member.id, kind: 'follow', role: 'member', status: 'active' },
  ]);
  const { data: made } = await admin.from('teams').insert([{ org_id: club.id, name: `Blazers ${stamp}` }, { org_id: club.id, name: `Comets ${stamp}` }]).select('id, name');
  const blazers = made!.find(t => (t.name as string).startsWith('Blazers'))! as { id: string; name: string };
  const comets = made!.find(t => (t.name as string).startsWith('Comets'))! as { id: string; name: string };
  const ownerApi = await apiAs('state-b.json');
  const memberApi = await apiAs('state.json');
  const anon = await browser.newContext({ storageState: 'e2e/.auth/anon.json' });
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 390, height: 844 } });
  try {
    const teamsUrl = `/api/clubs/${club.id}/structure/teams`;
    // Refusals by name.
    let res = await memberApi.patch(teamsUrl, { data: { id: blazers.id, name: 'Nope' } });
    expect(res.status()).toBe(403);
    res = await ownerApi.patch(teamsUrl, { data: { id: blazers.id, name: comets.name } });
    expect(res.status(), await readErrorBody(res)).toBe(409);
    res = await ownerApi.patch(teamsUrl, { data: { id: blazers.id, primaryColor: 'purple' } });
    expect(res.status()).toBe(400);
    res = await ownerApi.patch(teamsUrl, { data: { id: blazers.id, sportKey: 'curling' } });
    expect(res.status()).toBe(400);

    // The console at phone width: rename, sport, two colours.
    const page = await ctx.newPage();
    await page.goto(`/app/org/club/${club.id}`);
    await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: `Edit ${blazers.name}` }).click();
    const form = page.locator(`[data-team-identity="${blazers.id}"]`);
    const renamed = `Blazers Gold ${stamp}`;
    await form.getByLabel('Name', { exact: true }).fill(renamed);
    await form.getByLabel('Sport').selectOption('ice_hockey');
    await form.getByLabel('Main colour', { exact: true }).fill('#7C3AED');
    await form.getByLabel('Second colour', { exact: true }).fill('#fde047');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await form.getByRole('button', { name: 'Save team' }).click();
    await expect(form).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByRole('region', { name: 'Teams' }).getByText(renamed, { exact: true })).toBeVisible({ timeout: 20_000 });
    const { data: saved } = await admin.from('teams').select('name, sport_key, primary_color, secondary_color').eq('id', blazers.id).single();
    expect(saved).toEqual({ name: renamed, sport_key: 'ice_hockey', primary_color: '#7c3aed', secondary_color: '#fde047' });

    // The logo: up, streamed anonymously from team-logos/, then removed.
    const png = fs.readFileSync(path.join(__dirname, 'fixtures', 'photo.png'));
    res = await ownerApi.post(`/api/clubs/${club.id}/teams/${blazers.id}/logo`, { multipart: { logo: { name: 'logo.png', mimeType: 'image/png', buffer: png } } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const up = (await res.json()) as { logoPath: string; logoUrl: string };
    expect(up.logoPath.startsWith(`team-logos/${blazers.id}/`)).toBe(true);
    const streamed = await anon.request.get(up.logoUrl);
    expect(streamed.status()).toBe(200);
    expect(streamed.headers()['content-type']).toContain('image/png');
    expect((await memberApi.post(`/api/clubs/${club.id}/teams/${blazers.id}/logo`, { multipart: { logo: { name: 'x.png', mimeType: 'image/png', buffer: png } } })).status()).toBe(403);
    res = await ownerApi.delete(`/api/clubs/${club.id}/teams/${blazers.id}/logo`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await anon.request.get(`/api/media/team-logo/${blazers.id}`)).status()).toBe(404);
  } finally {
    await ctx.close();
    await anon.close();
    await ownerApi.dispose();
    await memberApi.dispose();
    await deleteQaOrgs(admin, [club.id]);
  }
});
