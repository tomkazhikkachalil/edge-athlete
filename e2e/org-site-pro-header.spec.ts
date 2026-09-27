import { test, expect, type APIRequestContext, type Browser } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { publishSite } from './helpers/org-site';
import { settleBody } from './helpers/isr';

// Sports-team website program, L1 (Sep 27 2026): the sports header ('pro'
// — an accent strip over a large logo band), the wide page column, a Teams
// dropdown listing the club's teams, and a CSS-only phone menu (a native
// <details>; the public site ships no script). A team page is reachable
// from the phone menu in two taps, and the menu is closed on the next page.

interface Fixture {
  leagueId: string;
  base: string;
  teams: { id: string; name: string }[];
}

async function setUp(admin: ReturnType<typeof adminClient>, ownerApi: APIRequestContext, browser: Browser, stamp: number): Promise<Fixture> {
  const owner = loadQaUser('user-b.json');
  const league = await createQaOrg(admin, 'league', { name: `QA Pro Header League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  const leagueId = league.id;
  await admin.from('memberships').insert([{ org_id: leagueId, profile_id: owner.id, role: 'owner' }]);
  const { data: teams, error } = await admin
    .from('teams')
    .insert([{ org_id: leagueId, name: `Comets ${stamp}` }, { org_id: leagueId, name: `Blazers ${stamp}` }])
    .select('id, name');
  expect(error).toBeNull();

  let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
  expect(res.status(), await readErrorBody(res)).toBe(200);
  const subdomain = (await res.json()).site.subdomain as string;
  res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
  expect(res.status(), await readErrorBody(res)).toBe(200);
  res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'set_module', moduleKey: 'teams', enabled: true } });
  expect(res.status(), await readErrorBody(res)).toBe(200);
  res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'set_theme', accent: '#0f766e', header: 'pro', width: 'wide' } });
  expect(res.status(), await readErrorBody(res)).toBe(200);
  await publishSite(ownerApi, 'league', leagueId, 'Sports header');

  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const probe = await anon.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
    const base = probe.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;
    // The published header carries the teams (ISR: settle on the new markup).
    await settleBody(anon.request, base, 'data-site-teams-menu', true, 12);
    return { leagueId, base, teams: teams as { id: string; name: string }[] };
  } finally {
    await anon.close();
  }
}

test('sports header on a large screen: the strip + logo band, a wide column, the Teams dropdown reaches a team', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  await resetRateBucket(admin, 'org-site', owner.id);
  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  let leagueId: string | null = null;
  try {
    const fx = await setUp(admin, ownerApi, browser, stamp);
    leagueId = fx.leagueId;
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1280, height: 900 } });
    try {
      const page = await anon.newPage();
      await page.goto(fx.base);
      await expect(page.locator('header[data-site-header="pro"]')).toBeVisible();
      // The wide column: 76rem.
      const maxWidth = await page.locator('main .site-container, header .site-container').first().evaluate(el => getComputedStyle(el).maxWidth);
      expect(maxWidth).toBe('1216px');
      // md+: the inline row; the phone menu button is hidden.
      const nav = page.getByRole('navigation', { name: 'Site navigation' });
      await expect(nav).toBeVisible();
      await expect(page.locator('[data-site-menu] > summary')).toBeHidden();
      // The Teams dropdown lists the teams; a team link opens its page.
      const dropdown = nav.locator('[data-site-teams-menu]');
      await dropdown.locator('summary').click();
      const team = fx.teams.find(t => t.name.startsWith('Comets'))!;
      await dropdown.getByRole('link', { name: team.name }).click();
      await expect(page).toHaveURL(new RegExp(`/teams/${team.id}$`));
      await expect(page.getByRole('heading', { name: team.name })).toBeVisible();
    } finally {
      await anon.close();
    }
  } finally {
    await ownerApi.dispose();
    if (leagueId) {
      await admin.from('org_sites').delete().eq('org_id', leagueId);
      await deleteQaOrgs(admin, [leagueId]);
    }
  }
});

test('sports header on a phone: the menu opens without script, Teams → a team in two taps, closed on the next page @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  await resetRateBucket(admin, 'org-site', owner.id);
  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  let leagueId: string | null = null;
  try {
    const fx = await setUp(admin, ownerApi, browser, stamp);
    leagueId = fx.leagueId;
    // JavaScript OFF: the menu is a native <details> and must work without it.
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
    try {
      const page = await anon.newPage();
      await page.goto(fx.base);
      await expect(page.getByRole('navigation', { name: 'Site navigation' })).toBeHidden();
      const menu = page.locator('[data-site-menu]');
      await menu.locator('> summary').click();
      const sheet = page.getByRole('navigation', { name: 'Site menu' });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole('link', { name: 'Home' })).toBeVisible();
      // Teams expands in place; a team is the second tap.
      await sheet.locator('summary', { hasText: 'Teams' }).click();
      const team = fx.teams.find(t => t.name.startsWith('Blazers'))!;
      await sheet.getByRole('link', { name: team.name }).click();
      await expect(page).toHaveURL(new RegExp(`/teams/${team.id}$`));
      await expect(page.getByRole('heading', { name: team.name })).toBeVisible();
      // A full navigation: the menu starts closed on the new page.
      await expect(page.getByRole('navigation', { name: 'Site menu' })).toBeHidden();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 390px').toBeLessThanOrEqual(390);
    } finally {
      await anon.close();
    }
  } finally {
    await ownerApi.dispose();
    if (leagueId) {
      await admin.from('org_sites').delete().eq('org_id', leagueId);
      await deleteQaOrgs(admin, [leagueId]);
    }
  }
});
