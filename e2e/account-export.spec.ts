import { test, expect, request as pwRequest } from './helpers/test';
import { E2E_BASE_URL, bypassHeaders, createQaUser, deleteQaUser, mintStorageState } from './helpers/qa-user';

// ── The account's own data export (Nov 2 2026) ──────────────────────────────
// Settings → Account → "Your data" → one JSON file: the profile row and every
// row of the account's own in the sections the rule names. A's file carries
// A's post and never B's; a signed-out call is refused before any bucket;
// the door is on the page at phone width and the browser downloads the file.

test('the file carries the account\'s own rows and nothing of another\'s; the door downloads it @mobile', async ({ browser }) => {
  const a = await createQaUser({ displayName: 'Export Ann', firstName: 'Export', lastName: 'Ann' });
  const b = await createQaUser({ displayName: 'Export Bob', firstName: 'Export', lastName: 'Bob' });
  const apiA = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(a), extraHTTPHeaders: bypassHeaders() });
  const apiB = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(b), extraHTTPHeaders: bypassHeaders() });
  const anon = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: bypassHeaders() });
  try {
    const postOf = async (api: typeof apiA, caption: string) => {
      const r = await api.post('/api/posts', { data: { postType: 'general', caption, visibility: 'public' } });
      expect(r.status(), await r.text()).toBeLessThan(300);
      const j = await r.json();
      return (j.post?.id ?? j.id) as string;
    };
    const postA = await postOf(apiA, 'Ann exports');
    const postB = await postOf(apiB, 'Bob stays private');

    // Signed out: 401 before any bucket.
    expect((await anon.post('/api/account/export')).status()).toBe(401);

    // The file.
    const res = await apiA.post('/api/account/export');
    expect(res.status(), await res.text()).toBe(200);
    expect(res.headers()['content-disposition']).toMatch(/attachment; filename="edge-athlete-export-\d{4}-\d{2}-\d{2}\.json"/);
    expect(res.headers()['cache-control']).toContain('no-store');
    const file = await res.json();
    expect(file.format).toBe('edge-athlete-export/1');
    expect(file.account.id).toBe(a.id);
    expect(file.profile?.id).toBe(a.id);
    const postIds = (file.data.posts as Array<{ id: string }>).map(p => p.id);
    expect(postIds).toContain(postA);
    expect(postIds).not.toContain(postB);
    expect(file.data).toHaveProperty('golf_rounds');
    expect(file.data).toHaveProperty('messages_sent');
    expect(file.truncated).toEqual([]);

    // The door, at phone width: the browser downloads the file.
    const ctx = await browser.newContext({ storageState: await mintStorageState(a), extraHTTPHeaders: bypassHeaders(), acceptDownloads: true });
    const page = await ctx.newPage();
    try {
      await page.goto('/settings?tab=account');
      const button = page.locator('[data-export-download]');
      await expect(button).toBeVisible({ timeout: 20_000 });
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), button.click()]);
      expect(download.suggestedFilename()).toMatch(/^edge-athlete-export-\d{4}-\d{2}-\d{2}\.json$/);
      await expect(page.locator('[data-export-status="done"]')).toBeVisible();
    } finally {
      await ctx.close();
    }
  } finally {
    await apiA.dispose();
    await apiB.dispose();
    await anon.dispose();
    await deleteQaUser(a.id);
    await deleteQaUser(b.id);
  }
});
