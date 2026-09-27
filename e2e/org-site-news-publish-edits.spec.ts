import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Sports-team website program, P0-1 (Sep 27 2026): Publish in the news
// editor used to PATCH `{publish}` alone and then refetch the post — the
// refetch replaced the form with the server copy, so a title or paragraph
// typed but not yet saved was silently lost. The toggle now carries the
// unsaved edits in the same PATCH and adopts the response. Phone width:
// the editor is a manager's phone surface too.

test('news editor: Publish keeps the unsaved title and paragraph (no silent loss) @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
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
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site/news/${post.id}`, {
      data: { body: [{ type: 'paragraph', text: 'First words.' }] },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    const page = await ctx.newPage();
    page.setDefaultTimeout(20_000);
    await page.goto(`/app/org/league/${leagueId}/site/news/${post.id}`);
    const titleInput = page.getByLabel('Page title');
    await expect(titleInput).toHaveValue(`Draft ${stamp}`, { timeout: 30_000 });

    // Type, then publish WITHOUT pressing Save.
    const newTitle = `Opening night ${stamp}`;
    await titleInput.fill(newTitle);
    await page.getByLabel('Paragraph text for block 1').fill('Doors at six. Puck drop at seven.');
    await page.getByRole('button', { name: 'Publish post' }).click();
    await expect(page.getByRole('button', { name: 'Unpublish' })).toBeVisible({ timeout: 15_000 });

    // The form still shows what was typed (no refetch overwrote it) …
    await expect(titleInput).toHaveValue(newTitle);
    await expect(page.getByLabel('Paragraph text for block 1')).toHaveValue('Doors at six. Puck drop at seven.');

    // … and the server has it, live.
    const saved = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/news/${post.id}`)).json()).post as {
      title: string;
      body: { type: string; text?: string }[];
      published_at: string | null;
    };
    expect(saved.title).toBe(newTitle);
    expect(saved.body[0]?.text).toBe('Doors at six. Puck drop at seven.');
    expect(saved.published_at).not.toBeNull();

    // A reload reads the same thing back, with nothing left unsaved.
    await page.reload();
    await expect(titleInput).toHaveValue(newTitle, { timeout: 30_000 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow at 390px').toBeLessThanOrEqual(390);
  } finally {
    await ctx.close();
    await ownerApi.dispose();
    await admin.from('org_sites').delete().eq('org_id', leagueId);
    await deleteQaOrgs(admin, [leagueId]);
  }
});
