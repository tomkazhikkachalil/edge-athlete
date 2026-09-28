import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Sports-team website program, P0-1 → N4 (Sep 27 2026): Publish must never
// lose what was just typed. P0 fixed the old block editor (its Publish
// refetched over unsaved text); the newsroom replaced that editor with an
// autosaving composer, so the rule is now: pressing Publish immediately
// after typing — before the autosave's debounce fires — FLUSHES the pending
// edit first, and the post goes live with it. Phone width: the newsroom is a
// bottom sheet there.

test('newsroom: Publish right after typing keeps the new title and paragraph (the pending autosave flushes first) @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'org-site-news-draft', owner.id);
  const probe = await admin.from('org_site_news').select('draft').limit(1);
  test.skip(probe.error?.code === '42703', 'org_site_news.draft missing — run migration 243');
  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA News Edits League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  const leagueId = league.id;
  await admin.from('memberships').insert([{ org_id: leagueId, profile_id: owner.id, role: 'owner' }]);

  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 390, height: 844 } });
  try {
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await ownerApi.post(`/api/leagues/${leagueId}/site/news`, { data: { title: `Draft ${stamp}` } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const post = (await res.json()).post as { id: string };
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site/news/${post.id}`, { data: { body: [{ type: 'paragraph', text: 'First words.' }] } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    const page = await ctx.newPage();
    page.setDefaultTimeout(20_000);
    await page.goto(`/app/org/league/${leagueId}/site/edit?news=${post.id}`);
    const sheet = page.locator('[data-larger-window="sb-news"]');
    const titleInput = sheet.getByLabel('Title', { exact: true });
    await expect(titleInput).toHaveValue(`Draft ${stamp}`, { timeout: 30_000 });

    // Type, then publish at once — no waiting for the autosave.
    const newTitle = `Opening night ${stamp}`;
    await titleInput.fill(newTitle);
    await sheet.getByLabel('Paragraph 1', { exact: true }).fill('Doors at six. Puck drop at seven.');
    await sheet.locator('[data-sb-news-publish]').click();
    await expect(sheet.locator('[data-sb-news-composer]')).toHaveAttribute('data-sb-news-state', 'live', { timeout: 15_000 });

    // The form still shows what was typed …
    await expect(titleInput).toHaveValue(newTitle);
    await expect(sheet.getByLabel('Paragraph 1', { exact: true })).toHaveValue('Doors at six. Puck drop at seven.');

    // … and the server has it, live (the edit went to the columns before the publish).
    const saved = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/news/${post.id}`)).json()).post as {
      title: string;
      body: { type: string; text?: string }[];
      published_at: string | null;
      draft: unknown;
    };
    expect(saved.title).toBe(newTitle);
    expect(saved.body[0]?.text).toBe('Doors at six. Puck drop at seven.');
    expect(saved.published_at).not.toBeNull();
    expect(saved.draft).toBeNull();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow at 390px').toBeLessThanOrEqual(390);
  } finally {
    await ctx.close();
    await ownerApi.dispose();
    await admin.from('org_sites').delete().eq('org_id', leagueId);
    await deleteQaOrgs(admin, [leagueId]);
  }
});
