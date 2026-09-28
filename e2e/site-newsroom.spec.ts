import { test, expect, type Page } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { settleBody, settleStatus } from './helpers/isr';

// Sports-team website program, N4 (Sep 27 2026): the newsroom inside the site
// editor. One manager writes news where they edit the site: "News" → New
// post → type (it autosaves; a reload keeps it) → Schedule (off the site
// until then) → Publish now → edit the LIVE post (the site keeps the old
// words until Update) → Update. At phone width the newsroom is a bottom sheet
// reached from the same header button. Skips (green) without migration 243.

async function setUp(stamp: number) {
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  for (const b of ['org-site', 'org-site-pages', 'org-site-news-draft'] as const) await resetRateBucket(admin, b, owner.id);
  const ownerApi = await apiAs('state-b.json');
  const league = await createQaOrg(admin, 'league', { name: `QA Newsroom League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  await admin.from('memberships').insert([{ org_id: league.id, profile_id: owner.id, role: 'owner' }]);
  let res = await ownerApi.post(`/api/leagues/${league.id}/site`);
  expect(res.status(), await readErrorBody(res)).toBe(200);
  const subdomain = (await res.json()).site.subdomain as string;
  res = await ownerApi.patch(`/api/leagues/${league.id}/site`, { data: { action: 'publish' } });
  expect(res.status(), await readErrorBody(res)).toBe(200);
  return { admin, ownerApi, leagueId: league.id, subdomain };
}

async function cleanUp(admin: ReturnType<typeof adminClient>, leagueId: string) {
  const siteIds = ((await admin.from('org_sites').select('id').eq('org_id', leagueId)).data ?? []).map(r => r.id as string);
  if (siteIds.length) await admin.from('org_site_news').delete().in('site_id', siteIds);
  await admin.from('org_sites').delete().eq('org_id', leagueId);
  await deleteQaOrgs(admin, [leagueId]);
}

async function waitSaved(page: Page) {
  await expect(page.locator('[data-sb-news-save]')).toHaveAttribute('data-sb-news-save', 'saved', { timeout: 15_000 });
}

test.beforeAll(async () => {
  const probe = await adminClient().from('org_site_news').select('draft').limit(1);
  test.skip(probe.error?.code === '42703', 'org_site_news.draft missing — run migration 243');
});

test('newsroom: new post → autosave survives a reload → schedule → publish now → a live edit waits for Update', async ({ browser }) => {
  test.setTimeout(300_000);
  const stamp = Date.now();
  const { admin, ownerApi, leagueId, subdomain } = await setUp(stamp);
  try {
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 1280, height: 900 } });
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const page = await ctx.newPage();
      await page.goto(`/app/org/league/${leagueId}/site/edit`);
      await expect(page.locator('[data-sb-canvas]')).toBeVisible({ timeout: 30_000 });
      await page.locator('[data-sb-open-news]').click();
      const win = page.locator('[data-larger-window="sb-news"]');
      await expect(win.locator('[data-sb-news-list]')).toBeVisible();
      await win.locator('[data-sb-news-new]').click();
      const composer = win.locator('[data-sb-news-composer]');
      await expect(composer).toHaveAttribute('data-sb-news-state', 'draft', { timeout: 20_000 });
      const postId = (await composer.getAttribute('data-sb-news-composer'))!;

      // Type — it autosaves; a reload (the deep link) brings it all back.
      const title = `Opening night ${stamp}`;
      await win.getByLabel('Title', { exact: true }).fill(title);
      await win.getByLabel('Summary', { exact: true }).fill('Doors at six.');
      await win.getByRole('button', { name: '+ Paragraph' }).click();
      await win.getByLabel('Paragraph 1', { exact: true }).fill(`First words ${stamp}.`);
      await waitSaved(page);
      await page.goto(`/app/org/league/${leagueId}/site/edit?news=${postId}`);
      await expect(win.getByLabel('Title', { exact: true })).toHaveValue(title, { timeout: 30_000 });
      await expect(win.getByLabel('Summary', { exact: true })).toHaveValue('Doors at six.');
      await expect(win.getByLabel('Paragraph 1', { exact: true })).toHaveValue(`First words ${stamp}.`);

      // Schedule two days ahead: off the site until then.
      const when = new Date(Date.now() + 2 * 86_400_000);
      const local = new Date(when.getTime() - when.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
      await win.locator('[data-sb-news-when]').fill(local);
      await win.locator('[data-sb-news-schedule]').click();
      await expect(composer).toHaveAttribute('data-sb-news-state', 'scheduled', { timeout: 15_000 });
      const { data: row } = await admin.from('org_site_news').select('slug').eq('id', postId).single();
      const slug = row!.slug as string;
      const probe = await anon.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
      const base = probe.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;
      expect(await settleStatus(anon.request, `${base}/news/${slug}`, 404)).toBe(404);

      // Publish now overrides the schedule.
      await win.locator('[data-sb-news-publish]').click();
      await expect(composer).toHaveAttribute('data-sb-news-state', 'live', { timeout: 15_000 });
      await settleBody(anon.request, `${base}/news/${slug}`, title, true, 12);

      // Edit the live post: the site keeps the old title until Update.
      const updated = `Opening night — sold out ${stamp}`;
      await win.getByLabel('Title', { exact: true }).fill(updated);
      await waitSaved(page);
      await expect(win.locator('[data-sb-news-line]')).toContainText('Press Update');
      const still = await (await anon.request.get(`${base}/news/${slug}`)).text();
      expect(still).not.toContain(updated);
      await win.locator('[data-sb-news-update]').click();
      await expect(win.locator('[data-sb-news-line]')).toContainText('Live on your site', { timeout: 15_000 });
      await settleBody(anon.request, `${base}/news/${slug}`, updated, true, 12);

      // The list files it under Live.
      await win.getByRole('button', { name: '← All news' }).click();
      await expect(win.locator('[data-sb-news-group="live"]')).toContainText(updated);
    } finally {
      await ctx.close();
      await anon.close();
    }
  } finally {
    await ownerApi.dispose();
    await cleanUp(admin, leagueId);
  }
});

test('newsroom on a phone: News in the header opens the sheet; write and publish @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const { admin, ownerApi, leagueId } = await setUp(stamp);
  try {
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 390, height: 844 } });
    try {
      const page = await ctx.newPage();
      await page.goto(`/app/org/league/${leagueId}/site/edit`);
      await page.locator('[data-sb-open-news]').click({ timeout: 30_000 });
      const sheet = page.locator('[data-larger-window="sb-news"]');
      await sheet.locator('[data-sb-news-new]').click();
      const composer = sheet.locator('[data-sb-news-composer]');
      await expect(composer).toHaveAttribute('data-sb-news-state', 'draft', { timeout: 20_000 });
      await sheet.getByLabel('Title', { exact: true }).fill(`Phone post ${stamp}`);
      await sheet.locator('[data-sb-news-publish]').click();
      await expect(composer).toHaveAttribute('data-sb-news-state', 'live', { timeout: 15_000 });
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 390px').toBeLessThanOrEqual(390);
      const postId = (await composer.getAttribute('data-sb-news-composer'))!;
      const { data } = await admin.from('org_site_news').select('title, published_at').eq('id', postId).single();
      expect(data).toMatchObject({ title: `Phone post ${stamp}` });
      expect(data!.published_at).not.toBeNull();
    } finally {
      await ctx.close();
    }
  } finally {
    await ownerApi.dispose();
    await cleanUp(admin, leagueId);
  }
});
