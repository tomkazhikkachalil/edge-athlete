import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, resetRateBucket } from './helpers/qa-user';

// Phase 9 V3 — the join door. A club's public site carries "Join {club}"
// (an absolute app link); the app's /join/club/[id] page asks for an
// account first (the C1 door: the intent parks in sessionStorage and
// rides `?next=`), then joins — instantly on an open club, as a request
// on an approval club. 375px on the site and the door.

const stamp = Math.random().toString(36).slice(2, 8);

async function readErrorBody(res: { text: () => Promise<string> }): Promise<string> {
  return (await res.text()).slice(0, 300);
}

test('join door: site CTA → account-first → sign in returns → request to join (approval) / join (open); member sees "You’re in"; 375px', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const alpha = loadQaUser('user.json');
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'club-join', alpha.id);
  const probe = await admin.from('clubs').select('join_policy').limit(1);
  test.skip(!!probe.error, `membership columns missing — run migration 176 (${probe.error?.message})`);

  const club = await createQaOrg(admin, 'club', { name: `QA Door Club ${stamp}`, owner_profile_id: owner.id, sport_key: 'golf', join_policy: 'approval', city: 'Kanata', region: 'ON' });
  const clubId = club.id;
  const openClub = await createQaOrg(admin, 'club', { name: `QA Open Door ${stamp}`, owner_profile_id: owner.id, sport_key: 'golf' });
  const openClubId = openClub.id;
  await admin.from('memberships').insert([
    { org_id: clubId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { org_id: openClubId, profile_id: owner.id, role: 'owner', kind: 'follow' },
  ]);

  const ownerApi = await apiAs('state-b.json');
  const anon = await browser.newContext({ storageState: 'e2e/.auth/anon.json', viewport: { width: 375, height: 812 } });
  try {
    // The site carries the door.
    let res = await ownerApi.post(`/api/clubs/${clubId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = ((await res.json()).site as { subdomain: string }).subdomain;
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    let html = '';
    await expect
      .poll(async () => { const r = await anon.request.get(`/org/${subdomain}`); html = r.ok() ? await r.text() : ''; return r.status(); }, { timeout: 30_000, intervals: [1000, 2000, 3000] })
      .toBe(200);
    expect(html).toContain(`Join QA Door Club ${stamp}`);
    expect(html).toContain(`/join/club/${clubId}"`);

    // Signed-out door → the account-first card parks the intent; sign in returns here.
    const page = await anon.newPage();
    await page.goto(`/org/${subdomain}`);
    const door = page.locator('[data-join-door]');
    await expect(door).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'site: no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    await page.goto(`/join/club/${clubId}`);
    const cta = page.getByRole('link', { name: 'Create an account or sign in' });
    await expect(cta).toBeVisible({ timeout: 20_000 });
    expect(await cta.getAttribute('href')).toContain(`next=${encodeURIComponent(`/join/club/${clubId}`)}`);
    await cta.click();
    await page.locator('input[name="email"]').fill(alpha.email);
    await page.locator('input[name="password"]').fill(alpha.password);
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    await page.waitForURL(new RegExp(`/join/club/${clubId}`), { timeout: 30_000 });
    await expect(page.locator('[data-join-state="open"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('This club approves new members')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'door: no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    await page.getByRole('button', { name: 'Request to join' }).click();
    await expect(page.locator('[data-join-state="requested"]')).toBeVisible({ timeout: 20_000 });
    const { data: req } = await admin.from('org_join_requests').select('id').eq('org_id', clubId).eq('profile_id', alpha.id);
    expect(req ?? []).toHaveLength(1);
    // A reload keeps the state (the GET's viewerRequestPending).
    await page.reload();
    await expect(page.locator('[data-join-state="requested"]')).toBeVisible({ timeout: 20_000 });

    // The open club joins on the spot, then reads "You’re in".
    await page.goto(`/join/club/${openClubId}`);
    await expect(page.locator('[data-join-state="open"]')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: `Join QA Open Door ${stamp}` }).click();
    await expect(page.locator('[data-join-state="member"]')).toBeVisible({ timeout: 20_000 });
    // Onboarding v2 R3 (Sep 8 2026): "count my rounds" rides the join, so an
    // adult's join writes the FOLLOW row and a ROSTER row — both plain members.
    const { data: rows } = await admin.from('memberships').select('role, kind').eq('org_id', openClubId).eq('profile_id', alpha.id).order('kind');
    expect(rows?.map(r => [r.kind, r.role])).toEqual([['follow', 'member'], ['roster', 'member']]);
    await page.reload();
    await expect(page.locator('[data-join-state="member"]')).toBeVisible({ timeout: 20_000 });
  } finally {
    await anon.close();
    await ownerApi.dispose();
    await admin.from('notifications').delete().contains('metadata', { club_id: clubId });
    await deleteQaOrgs(admin, [clubId, openClubId]);
  }
});
