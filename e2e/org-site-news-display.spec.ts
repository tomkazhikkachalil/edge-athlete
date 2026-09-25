import { test, expect, type APIRequestContext } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { publishSite, revisionsSupported } from './helpers/org-site';
import { settleBody } from './helpers/isr';

// Site Builder program 3, D4 — the news section's axes: a grid or a
// featured post, the manager's own order, a post that expands in place
// (a native <details>, no script), and — once migration 189 has run — a
// pin on the post that leads the news page and the home's pinned-first
// sort. The pin half skips (green) on a database without 189.

const PIN_NEEDS_189 = 'migration 189';

async function makePost(api: APIRequestContext, leagueId: string, title: string, paragraph: string): Promise<{ id: string; slug: string }> {
  let res = await api.post(`/api/leagues/${leagueId}/site/news`, { data: { title } });
  expect(res.status(), await readErrorBody(res)).toBe(200);
  const post = (await res.json()).post as { id: string; slug: string };
  res = await api.patch(`/api/leagues/${leagueId}/site/news/${post.id}`, { data: { body: [{ type: 'paragraph', text: paragraph }], publish: true } });
  expect(res.status(), await readErrorBody(res)).toBe(200);
  return post;
}

test('org site news: grid + my own order + expands in place reach the published page; a pinned post leads (189)', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA News League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  const leagueId = league.id;
  await admin.from('memberships').insert([{ org_id: leagueId, profile_id: owner.id, role: 'owner' }]);

  try {
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = (await res.json()).site.subdomain as string;
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    test.skip(!(await revisionsSupported(ownerApi, 'league', leagueId)), 'org_site_revisions missing — run migration 180');

    // Two posts, oldest first: A then B (the reader lists B, A).
    const a = await makePost(ownerApi, leagueId, `Alpha post ${stamp}`, `Alpha body ${stamp}.`);
    const b = await makePost(ownerApi, leagueId, `Bravo post ${stamp}`, `Bravo body ${stamp}.`);

    // The news section: a grid, my own order (A before B), expands in place.
    const canvas = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { widgets: { id: string; key: string; config: Record<string, unknown> }[] } };
    const news = canvas.layout.widgets.find(w => w.key === 'news')!;
    const withDisplay = (display: Record<string, unknown>) => ({ ...canvas.layout, widgets: canvas.layout.widgets.map(w => (w.id === news.id ? { ...w, config: { ...w.config, display } } : w)) });
    res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, { data: { layout: withDisplay({ variant: 'grid', sort: 'manual', order: [a.slug, b.slug], click: 'inline' }) } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, { data: { layout: withDisplay({ sort: 'random' }) } });
    expect(res.status()).toBe(400);

    await publishSite(ownerApi, 'league', leagueId);
    const anon = await browser.newContext({ storageState: 'e2e/.auth/anon.json' });
    try {
      const html = await settleBody(anon.request, `/org/${subdomain}`, `data-news-inline="${a.slug}"`, true);
      const at = html.indexOf('data-home-news=');
      const block = html.slice(at, html.indexOf('</section>', at));
      expect(block).toContain('data-variant="grid"');
      expect(block.indexOf(`Alpha post ${stamp}`)).toBeLessThan(block.indexOf(`Bravo post ${stamp}`));
      expect(block).toContain('<details');
      expect(block).toContain(`Alpha body ${stamp}.`);
    } finally {
      await anon.close();
    }

    // The pin (189): the post leads the news page and the home's pinned-first sort.
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site/news/${a.id}`, { data: { pinned: true } });
    if (res.status() === 400 && (await res.text()).includes(PIN_NEEDS_189)) {
      test.info().annotations.push({ type: 'skipped-half', description: 'pinning needs migration 189 — the server said so (a supported state)' });
      return;
    }
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(((await res.json()).post as { pinned_at?: string | null }).pinned_at).toBeTruthy();
    res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, { data: { layout: withDisplay({ variant: 'list', sort: 'pinned', click: 'detail' }) } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    await publishSite(ownerApi, 'league', leagueId);
    const anon2 = await browser.newContext({ storageState: 'e2e/.auth/anon.json' });
    try {
      const home = await settleBody(anon2.request, `/org/${subdomain}`, `data-news-pinned="${a.slug}"`, true);
      const at = home.indexOf('data-home-news=');
      const block = home.slice(at, home.indexOf('</section>', at));
      expect(block.indexOf(`Alpha post ${stamp}`)).toBeLessThan(block.indexOf(`Bravo post ${stamp}`));
      const page = await settleBody(anon2.request, `/org/${subdomain}/news`, `data-news-pinned="${a.slug}"`, true);
      expect(page.indexOf(`Alpha post ${stamp}`)).toBeLessThan(page.indexOf(`Bravo post ${stamp}`));
    } finally {
      await anon2.close();
    }
    // The console editor's toggle unpins.
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 1280, height: 900 } });
    try {
      const page = await ctx.newPage();
      page.setDefaultTimeout(20_000);
      await page.goto(`/app/org/league/${leagueId}/site/news/${a.id}`);
      const pin = page.locator('[data-news-pin]');
      await expect(pin).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });
      await pin.click();
      await expect(pin).toHaveAttribute('aria-pressed', 'false');
      const after = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/news/${a.id}`)).json()).post as { pinned_at?: string | null };
      expect(after.pinned_at).toBeNull();
    } finally {
      await ctx.close();
    }
  } finally {
    await deleteQaOrgs(admin, [leagueId]);
  }
});
