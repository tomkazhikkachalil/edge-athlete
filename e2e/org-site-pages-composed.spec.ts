import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { publishSite, revisionsSupported } from './helpers/org-site';
import { settleBody, settleStatus } from './helpers/isr';

// Program 2, B4 (Sep 11 2026): a page renders its composition publicly and
// the header honours order and hide. A live site gets two pages through the
// API: "About" (public, listed, arranged with words and a standings table
// through the draft PUT) and "Hidden" (public, unlisted). set_nav puts About
// BEFORE the standings link; publish; the public page carries the words as
// grid tiles (data-widget-id), the header reads About before Standings, the
// hidden page answers 200 but sits in no header, the vanity twin matches,
// the draft preview of a page works, and 375px does not overflow.

test('org site pages composed: layout renders publicly, header order and hide, page preview, vanity twin, 375px', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'org-site-draft', owner.id);
  await resetRateBucket(admin, 'org-site-pages', owner.id);
  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name: `QA Composed League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert([{ league_id: leagueId, profile_id: owner.id, role: 'owner' }]);
  try {
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = (await res.json()).site.subdomain as string;
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    test.skip(!(await revisionsSupported(ownerApi, 'league', leagueId)), 'org_site_revisions missing — run migration 180');
    const probe = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { pages: unknown };
    test.skip(probe.pages === null, 'org_site_pages.layout missing — run migration 185');

    // Two pages: About (listed) and Hidden (unlisted), both public.
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'add_page', title: `About ${stamp}`, slug: `about-${stamp}` } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const about = (await res.json()).page as { id: string; slug: string; layout: { widgets: { id: string }[] } };
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'add_page', title: `Hidden ${stamp}`, slug: `hidden-${stamp}` } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const hidden = (await res.json()).page as { id: string; slug: string };
    // A taken address is a 409; a reserved one a 400.
    expect((await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'add_page', title: 'Dup', slug: `about-${stamp}` } })).status()).toBe(409);
    expect((await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'add_page', title: 'Nope', slug: 'teams' } })).status()).toBe(400);
    // Arrange About: words in its text section + a standings table, through the draft PUT with pageId.
    const textId = about.layout.widgets[0].id;
    res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, {
      data: {
        pageId: about.id,
        layout: {
          version: 1,
          cols: 12,
          widgets: [
            { id: textId, key: 'text', x: 0, y: 0, w: 12, h: 3, cv: 1, config: { title: `Our story ${stamp}`, blocks: [{ type: 'paragraph', text: `Composed words ${stamp}` }] }, visibility: 'public' },
            { id: 'w_00000000000000b4', key: 'standings', x: 0, y: 3, w: 12, h: 4, cv: 1, config: {}, visibility: 'public' },
          ],
        },
      },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    // The hero is refused on a page; an unknown page is a 404.
    res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, {
      data: { pageId: about.id, layout: { version: 1, cols: 12, widgets: [{ id: 'h', key: 'hero', x: 0, y: 0, w: 12, h: 3, cv: 1, config: {}, visibility: 'public' }] } },
    });
    expect(res.status()).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('hero belongs to the home');
    res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, {
      data: { pageId: '00000000-0000-4000-8000-000000000000', layout: { version: 1, cols: 12, widgets: [] } },
    });
    expect(res.status()).toBe(404);
    // Both pages public; Hidden unlisted; About listed BEFORE the standings link.
    for (const [pageId, inNav] of [[about.id, true], [hidden.id, false]] as const) {
      res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'set_page', pageId, visibility: 'public', inNav } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
    }
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'set_nav', items: [{ key: `page:${about.id}` }, { key: 'standings' }, { key: 'schedule' }] } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // The draft preview of the page (the manager's tab): the words, before publish.
    const mint = await ownerApi.post(`/api/leagues/${leagueId}/site/preview`);
    expect(mint.status(), await readErrorBody(mint)).toBe(200);
    const previewUrl = (await mint.json()).url as string;
    const previewHtml = await (await ownerApi.get(`${previewUrl}/${about.slug}`)).text();
    expect(previewHtml).toContain(`Composed words ${stamp}`);
    expect(previewHtml).toContain('Draft preview of');
    expect((await ownerApi.get(`${previewUrl}/no-such-page-${stamp}`)).status()).toBe(404);

    await publishSite(ownerApi, 'league', leagueId, 'Composed');

    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const pathFor = async (sub: string) => {
        const probe = await anon.request.get(`/org/${sub}`, { maxRedirects: 0 });
        return probe.status() === 301 ? `/${sub}` : `/org/${sub}`;
      };
      const base = await pathFor(subdomain);
      // The page renders its composition: the words as a grid tile with its instance id; the empty standings never renders.
      const html = await settleBody(anon.request, `${base}/${about.slug}`, `Composed words ${stamp}`);
      expect(html).toContain(`data-widget-id="${textId}"`);
      expect(html).toContain(`Our story ${stamp}`);
      expect(html).not.toContain('data-widget-id="w_00000000000000b4"');
      expect(html).toContain(`<h1`);
      // The header: About before Standings; Hidden nowhere.
      const homeHtml = await settleBody(anon.request, base, `About ${stamp}`);
      const navHtml = homeHtml.slice(homeHtml.indexOf('aria-label="Site navigation"'), homeHtml.indexOf('</nav>'));
      expect(navHtml.indexOf(`About ${stamp}`)).toBeGreaterThan(-1);
      expect(navHtml.indexOf(`About ${stamp}`)).toBeLessThan(navHtml.indexOf('>Standings<'));
      expect(navHtml).not.toContain(`Hidden ${stamp}`);
      // The hidden page is reachable at its address.
      expect(await settleStatus(anon.request, `${base}/${hidden.slug}`, 200)).toBe(200);
      // The other route tree answers the same page.
      const twin = base.startsWith('/org/') ? `/${subdomain}` : `/org/${subdomain}`;
      const twinRes = await anon.request.get(`${twin}/${about.slug}`, { maxRedirects: 0 });
      expect([200, 301]).toContain(twinRes.status());
      // Program 2, B5 — the console: the navigation list holds the page row;
      // unticking "Show in the header" writes set_page; after a publish the
      // header drops it; ticking it back and moving it below Standings, then
      // Save navigation → publish → the header reads Standings before About.
      const ownerCtx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 1280, height: 900 } });
      try {
        const console_ = await ownerCtx.newPage();
        await console_.goto(`/app/org/league/${leagueId}`);
        const row = console_.locator(`[data-console-nav-page="${about.id}"]`);
        await expect(row).toBeVisible({ timeout: 30_000 });
        const tick = row.getByLabel(`Show About ${stamp} in the header`);
        await expect(tick).toBeChecked();
        await tick.click();
        await expect(console_.getByRole('alert').filter({ hasText: 'Page hidden from the header' })).toBeVisible({ timeout: 15_000 });
        await publishSite(ownerApi, 'league', leagueId, 'Hidden');
        const hiddenHome = await settleBody(anon.request, base, `About ${stamp}`, false);
        expect(hiddenHome).not.toContain(`>About ${stamp}<`);
        await console_.reload();
        const tick2 = console_.locator(`[data-console-nav-page="${about.id}"]`).getByLabel(`Show About ${stamp} in the header`);
        await expect(tick2).not.toBeChecked({ timeout: 30_000 });
        await tick2.click();
        await expect(console_.getByRole('alert').filter({ hasText: 'Page shown in the header' })).toBeVisible({ timeout: 15_000 });
        await console_.locator(`[data-console-nav-page="${about.id}"]`).getByRole('button', { name: `Move About ${stamp} down` }).click();
        await console_.getByRole('button', { name: 'Save navigation' }).click();
        await expect(console_.getByRole('alert').filter({ hasText: 'Layout saved' })).toBeVisible({ timeout: 15_000 });
        // The Pages card: the page with its status and the editor's door.
        const card = console_.locator(`[data-console-page="${about.id}"]`);
        await expect(card).toContainText('published');
        await expect(card.getByRole('link', { name: 'Edit in editor' })).toHaveAttribute('href', new RegExp(`/site/edit\\?page=${about.id}$`));
      } finally {
        await ownerCtx.close();
      }
      await publishSite(ownerApi, 'league', leagueId, 'Reordered');
      const reordered = await settleBody(anon.request, base, `About ${stamp}`);
      const nav2 = reordered.slice(reordered.indexOf('aria-label="Site navigation"'), reordered.indexOf('</nav>'));
      expect(nav2.indexOf('>Standings<')).toBeGreaterThan(-1);
      expect(nav2.indexOf('>Standings<')).toBeLessThan(nav2.indexOf(`About ${stamp}`));

      // 375px: the page and its header inside the viewport.
      const page = await anon.newPage();
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`${base}/${about.slug}`);
      await expect(page.getByText(`Composed words ${stamp}`)).toBeVisible({ timeout: 15_000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    } finally {
      await anon.close();
    }
  } finally {
    await ownerApi.dispose();
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
