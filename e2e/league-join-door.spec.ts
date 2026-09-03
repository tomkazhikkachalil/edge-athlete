import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, resetRateBucket } from './helpers/qa-user';

// Program 11 L1 — the join door for leagues (the twin of club-join-door). A
// league's public site carries "Join {league}" (an absolute app link); the
// app's /join/league/[id] page asks for an account first (the C1 door: the
// intent parks in sessionStorage and rides `?next=`), then joins —
// instantly on an open league, as a request on an approval league. 375px
// on the site and the door.

const stamp = Math.random().toString(36).slice(2, 8);

async function readErrorBody(res: { text: () => Promise<string> }): Promise<string> {
  return (await res.text()).slice(0, 300);
}

test('league join door: site CTA → account-first → sign in returns → request to join (approval) / join (open); member sees "You’re in"; 375px', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const alpha = loadQaUser('user.json');
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'league-join', alpha.id);
  const probe = await admin.from('leagues').select('join_policy').limit(1);
  test.skip(!!probe.error, `membership columns missing — run migration 177 (${probe.error?.message})`);

  const { data: league } = await admin
    .from('leagues')
    .insert({ name: `QA Door League ${stamp}`, owner_profile_id: owner.id, sport_key: 'golf', join_policy: 'approval', city: 'Kanata', region: 'ON' })
    .select('id')
    .single();
  const leagueId = league!.id as string;
  const { data: openLeague } = await admin
    .from('leagues')
    .insert({ name: `QA Open Door League ${stamp}`, owner_profile_id: owner.id, sport_key: 'golf' })
    .select('id')
    .single();
  const openLeagueId = openLeague!.id as string;
  await admin.from('memberships').insert([
    { league_id: leagueId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { league_id: openLeagueId, profile_id: owner.id, role: 'owner', kind: 'follow' },
  ]);

  const ownerApi = await apiAs('state-b.json');
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 375, height: 812 } });
  try {
    // The site carries the door.
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = ((await res.json()).site as { subdomain: string }).subdomain;
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    let html = '';
    await expect
      .poll(async () => { const r = await anon.request.get(`/org/${subdomain}`); html = r.ok() ? await r.text() : ''; return r.status(); }, { timeout: 30_000, intervals: [1000, 2000, 3000] })
      .toBe(200);
    expect(html).toContain(`Join QA Door League ${stamp}`);
    expect(html).toContain(`/join/league/${leagueId}"`);

    // Signed-out door → the account-first card parks the intent; sign in returns here.
    const page = await anon.newPage();
    await page.goto(`/org/${subdomain}`);
    const door = page.locator('[data-join-door]');
    await expect(door).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'site: no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    await page.goto(`/join/league/${leagueId}`);
    const cta = page.getByRole('link', { name: 'Create an account or sign in' });
    await expect(cta).toBeVisible({ timeout: 20_000 });
    expect(await cta.getAttribute('href')).toContain(`next=${encodeURIComponent(`/join/league/${leagueId}`)}`);
    await cta.click();
    await page.locator('input[name="email"]').fill(alpha.email);
    await page.locator('input[name="password"]').fill(alpha.password);
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    await page.waitForURL(new RegExp(`/join/league/${leagueId}`), { timeout: 30_000 });
    await expect(page.locator('[data-join-state="open"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('This league approves new members')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'door: no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    await page.getByRole('button', { name: 'Request to join' }).click();
    await expect(page.locator('[data-join-state="requested"]')).toBeVisible({ timeout: 20_000 });
    const { data: req } = await admin.from('league_join_requests').select('id').eq('league_id', leagueId).eq('profile_id', alpha.id);
    expect(req ?? []).toHaveLength(1);
    // A reload keeps the state (the GET's viewerRequestPending).
    await page.reload();
    await expect(page.locator('[data-join-state="requested"]')).toBeVisible({ timeout: 20_000 });

    // The open league joins on the spot, then reads "You’re in".
    await page.goto(`/join/league/${openLeagueId}`);
    await expect(page.locator('[data-join-state="open"]')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: `Join QA Open Door League ${stamp}` }).click();
    await expect(page.locator('[data-join-state="member"]')).toBeVisible({ timeout: 20_000 });
    const { data: rows } = await admin.from('memberships').select('role').eq('league_id', openLeagueId).eq('profile_id', alpha.id);
    expect(rows?.map(r => r.role)).toEqual(['member']);
    await page.reload();
    await expect(page.locator('[data-join-state="member"]')).toBeVisible({ timeout: 20_000 });

    // The phase-9 club URL shape still answers for a club id — and a bogus
    // side is a not-found, never a crash.
    await page.goto(`/join/team/${leagueId}`);
    await expect(page.getByRole('heading', { name: 'Club not found' })).toBeVisible({ timeout: 20_000 });
  } finally {
    await anon.close();
    await ownerApi.dispose();
    await admin.from('notifications').delete().contains('metadata', { league_id: leagueId });
    await admin.from('notifications').delete().contains('metadata', { league_id: openLeagueId });
    await admin.from('leagues').delete().in('id', [leagueId, openLeagueId]);
  }
});
