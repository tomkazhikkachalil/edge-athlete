import { test, expect, type APIRequestContext, type Browser } from '@playwright/test';
import { createQaOrg } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { publishSite, revisionsSupported } from './helpers/org-site';
import { awaitDraftSaved, settleBody } from './helpers/isr';

// Site Builder program 3, S2 — "Show sample data". On a fresh league the
// editor shows empty sections as they will look once the club is active,
// each chipped "Sample"; the toggle is on by default and remembered per
// site; a section with real content is never touched; and the sample never
// leaves the editor — the draft PUT body and the published page carry no
// trace of it (the sentinel every sample string carries).

const SENTINEL = 'Meadowvale';

async function freshLeague(api: APIRequestContext, stamp: number) {
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  const league = await createQaOrg(admin, 'league', { name: `QA Sample League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  const leagueId = league.id;
  await admin.from('memberships').insert([{ org_id: leagueId, profile_id: owner.id, role: 'owner' }]);
  let res = await api.post(`/api/leagues/${leagueId}/site`);
  expect(res.status(), await readErrorBody(res)).toBe(200);
  const subdomain = (await res.json()).site.subdomain as string;
  res = await api.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
  expect(res.status(), await readErrorBody(res)).toBe(200);
  return { admin, leagueId, subdomain };
}

async function ownerPage(browser: Browser, viewport: { width: number; height: number }) {
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport });
  return { ctx, page: await ctx.newPage() };
}

test('org site sample data: chips on empty sections, real content untouched, toggle remembered, nothing in the draft PUT or the published page', async ({ browser }) => {
  test.setTimeout(240_000);
  const ownerApi = await apiAs('state-b.json');
  const { admin, leagueId, subdomain } = await freshLeague(ownerApi, Date.now());
  try {
    test.skip(!(await revisionsSupported(ownerApi, 'league', leagueId)), 'org_site_revisions missing — run migration 180');
    const { ctx, page } = await ownerPage(browser, { width: 1280, height: 900 });
    try {
      // Record every draft PUT body: the sample must never be in one.
      const putBodies: string[] = [];
      await page.route('**/site/draft', async route => {
        if (route.request().method() === 'PUT') putBodies.push(route.request().postData() ?? '');
        await route.continue();
      });

      await page.goto(`/app/org/league/${leagueId}/site/edit`);
      await expect(page.locator('[data-sb-canvas]')).toBeVisible({ timeout: 30_000 });
      const toggle = page.locator('[data-sb-sample]');
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');

      // Empty sections carry the chip and the sample content; the staff
      // section has the owner (real) and is untouched.
      const standings = page.locator('[data-sb-instance][data-sb-widget="standings"]');
      const teams = page.locator('[data-sb-instance][data-sb-widget="teams"]');
      const staff = page.locator('[data-sb-instance][data-sb-widget="staff"]');
      await expect(standings.locator('[data-sb-sample-chip]')).toBeVisible();
      await expect(standings).toContainText(SENTINEL);
      await expect(teams.locator('[data-sb-sample-chip]')).toBeVisible();
      await expect(teams).toContainText('Northgate Wolves');
      await expect(staff.locator('[data-sb-sample-chip]')).toHaveCount(0);
      await expect(staff).not.toContainText(SENTINEL);

      // The picker previews an absent, empty section with the sample bag (chipped).
      await page.getByRole('button', { name: 'Add section' }).click();
      const picker = page.locator('[data-larger-window="sb-picker"]');
      await expect(picker).toBeVisible();
      const pickerTiles = picker.locator('[data-sb-picker] [data-sb-picker-tile]');
      if ((await pickerTiles.count()) > 0) {
        await expect(picker.locator('[data-sb-picker] [data-sb-sample-chip]').first()).toBeVisible({ timeout: 15_000 });
      }
      await page.keyboard.press('Escape');
      await expect(picker).toBeHidden();

      // Off: the honest empty state is back; the preference survives a reload.
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await expect(teams.locator('[data-sb-sample-chip]')).toHaveCount(0);
      await expect(teams).toContainText('No teams yet.');
      await expect(standings).not.toContainText(SENTINEL);
      await page.reload();
      await expect(page.locator('[data-sb-canvas]')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-sb-sample]')).toHaveAttribute('aria-pressed', 'false');
      await page.locator('[data-sb-sample]').click();
      await expect(page.locator('[data-sb-sample]')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('[data-sb-instance][data-sb-widget="teams"] [data-sb-sample-chip]')).toBeVisible();

      // Real content wins: sponsors saved through the console action, the
      // editor re-opened — the sponsors tile shows them, un-chipped, while
      // its empty neighbours stay sampled.
      const res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'set_sponsors', sponsors: [{ name: 'Real Sponsor Ltd', url: 'https://sponsor.example.com' }] } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      await page.reload();
      await expect(page.locator('[data-sb-canvas]')).toBeVisible({ timeout: 30_000 });
      const sponsors = page.locator('[data-sb-instance][data-sb-widget="sponsors"]');
      await expect(sponsors).toContainText('Real Sponsor Ltd');
      await expect(sponsors.locator('[data-sb-sample-chip]')).toHaveCount(0);
      await expect(sponsors).not.toContainText(SENTINEL);
      await expect(page.locator('[data-sb-instance][data-sb-widget="teams"] [data-sb-sample-chip]')).toBeVisible();

      // An edit on a sampled tile autosaves the REAL instance: the PUT body
      // carries the title and no sample string.
      await page.locator('[data-sb-instance][data-sb-widget="teams"] .sb-frame-controls').click();
      const panel = page.locator('[data-sb-panel="teams"]');
      await expect(panel).toBeVisible();
      await panel.getByLabel('Section title').fill('Our teams');
      await awaitDraftSaved(page);
      expect(putBodies.length).toBeGreaterThan(0);
      expect(putBodies.some(b => b.includes('Our teams'))).toBe(true);
      for (const b of putBodies) expect(b).not.toContain(SENTINEL);
      const draft = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { widgets: { key: string; config: Record<string, unknown> }[] } };
      expect(JSON.stringify(draft)).not.toContain(SENTINEL);
      expect(draft.layout.widgets.find(w => w.key === 'teams')?.config.title).toBe('Our teams');
    } finally {
      await ctx.close();
    }

    // Published: the public page carries the real sponsor and no sample.
    await publishSite(ownerApi, 'league', leagueId);
    const anon = await browser.newContext({ storageState: 'e2e/.auth/anon.json' });
    try {
      const html = await settleBody(anon.request, `/org/${subdomain}`, 'Real Sponsor Ltd', true);
      expect(html).not.toContain(SENTINEL);
      expect(html).not.toContain('data:image/svg+xml;base64');
    } finally {
      await anon.close();
    }
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});

test('@mobile org site sample data: the phone list chips sampled sections and the toggle clears them', async ({ browser }) => {
  test.setTimeout(180_000);
  const ownerApi = await apiAs('state-b.json');
  const { admin, leagueId } = await freshLeague(ownerApi, Date.now());
  try {
    test.skip(!(await revisionsSupported(ownerApi, 'league', leagueId)), 'org_site_revisions missing — run migration 180');
    const { ctx, page } = await ownerPage(browser, { width: 390, height: 844 });
    try {
      await page.goto(`/app/org/league/${leagueId}/site/edit`);
      const list = page.locator('[data-sb-sections]');
      await expect(list).toBeVisible({ timeout: 30_000 });
      const teamsRow = list.locator('[data-sb-section-key="teams"]');
      await expect(teamsRow.locator('[data-sb-sample-chip]')).toBeVisible();
      await expect(list.locator('[data-sb-section-key="staff"] [data-sb-sample-chip]')).toHaveCount(0);
      const toggle = page.locator('[data-sb-sample]');
      await expect(toggle).toBeVisible();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await expect(teamsRow.locator('[data-sb-sample-chip]')).toHaveCount(0);
      // Nothing wider than the phone.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(overflow).toBe(false);
    } finally {
      await ctx.close();
    }
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
