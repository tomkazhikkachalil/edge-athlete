import { test, expect } from '@playwright/test';
import { adminClient, apiAs, createQaUser, deleteQaUser, loadQaUser, mintStorageState, readErrorBody, resetRateBucket } from './helpers/qa-user';

// N3 (program 10) — the announcement archive. The rows are still the
// record: the members' read groups them by announcement_id (a non-member
// is refused), the in-app league page shows every notice to a member,
// the console lists what was sent, and the site's News page lists ONLY
// the ones a manager also put on the notice band ("Notices" — public by
// definition, stamped only when the band actually took the title). 375px.

const stamp = Math.random().toString(36).slice(2, 8);

test('announce archive: members read all, non-member 403, site Notices show the mirrored one, console history; 375px', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const alpha = loadQaUser('user.json'); // a member — the archive needs a NON-actor row
  await resetRateBucket(admin, 'org-announce', owner.id);
  await resetRateBucket(admin, 'org-site', owner.id);

  const { data: league } = await admin
    .from('leagues')
    .insert({ name: `QA Archive League ${stamp}`, sport_key: 'golf', owner_profile_id: owner.id })
    .select('id')
    .single();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert([
    { league_id: leagueId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { league_id: leagueId, profile_id: alpha.id, role: 'member', kind: 'follow' },
  ]);
  const outsider = await createQaUser();
  const ownerApi = await apiAs('state-b.json');
  const alphaApi = await apiAs('state.json');
  const outsiderCtx = await browser.newContext({ storageState: await mintStorageState(outsider) });
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const site = (await res.json()).site as { id: string; subdomain: string };
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { data: mod } = await admin.from('org_site_modules').select('enabled').eq('site_id', site.id).eq('module_key', 'news').maybeSingle();
    if (!mod?.enabled) {
      res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'set_module', moduleKey: 'news', enabled: true } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
    }

    // One plain, one mirrored to the site.
    const nextYear = `${new Date().getUTCFullYear() + 1}-06-30`;
    res = await ownerApi.post(`/api/leagues/${leagueId}/announce`, { data: { title: `Members meeting ${stamp}`, message: 'Thursday at 7.' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const plainId = (await res.json()).announcementId as string;
    res = await ownerApi.post(`/api/leagues/${leagueId}/announce`, {
      data: { title: `Rain-out ${stamp}`, message: 'Week 3 runs through Sunday.', siteNoticeUntil: nextYear },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const mirrored = (await res.json()) as { announcementId: string; siteNotice: boolean };
    expect(mirrored.siteNotice).toBe(true);

    // The stamp is on the rows (the truth, not a promise).
    const { data: rows } = await admin.from('notifications').select('metadata').contains('metadata', { announcement_id: mirrored.announcementId });
    expect(rows!.length).toBeGreaterThan(0);
    expect(rows!.every(r => (r.metadata as { site_notice?: boolean }).site_notice === true)).toBe(true);
    const { data: plainRows } = await admin.from('notifications').select('metadata').contains('metadata', { announcement_id: plainId });
    expect(plainRows!.every(r => (r.metadata as { site_notice?: boolean }).site_notice === undefined)).toBe(true);

    // The members' read: both, newest first, flagged; owner too; outsider 403; anon 401.
    type Item = { id: string; title: string; siteNotice: boolean; noticeUntil: string | null };
    res = await alphaApi.get(`/api/leagues/${leagueId}/announcements`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const list = (await res.json()).announcements as Item[];
    expect(list.map(a => a.id)).toEqual([mirrored.announcementId, plainId]);
    expect(list[0]).toMatchObject({ siteNotice: true, noticeUntil: nextYear });
    expect(list[0].title).toBe(`QA Archive League ${stamp}: Rain-out ${stamp}`);
    expect(list[1]).toMatchObject({ siteNotice: false, noticeUntil: null });
    expect((res.headers()['cache-control'] ?? '')).toContain('private');
    res = await ownerApi.get(`/api/leagues/${leagueId}/announcements`);
    expect(res.status()).toBe(200);
    expect(((await res.json()).announcements as Item[]).length).toBe(2);
    expect((await outsiderCtx.request.get(`/api/leagues/${leagueId}/announcements`)).status()).toBe(403);
    expect((await anon.request.get(`/api/leagues/${leagueId}/announcements`)).status()).toBe(401);

    // The site's News page: Notices lists the mirrored one only.
    let news = '';
    await expect
      .poll(async () => { const r = await anon.request.get(`/org/${site.subdomain}/news`); news = r.ok() ? await r.text() : ''; return news.includes('data-notices='); }, { timeout: 30_000, intervals: [1000, 2000, 3000] })
      .toBe(true);
    expect(news).toContain(`data-notice="${mirrored.announcementId}"`);
    expect(news).toContain(`Rain-out ${stamp}`);
    expect(news).not.toContain(`QA Archive League ${stamp}: Rain-out`); // the org prefix is stripped
    expect(news).not.toContain(`Members meeting ${stamp}`);

    // The member's league page at 375px: the card shows both.
    const memberCtx = await browser.newContext({ storageState: 'e2e/.auth/state.json' });
    try {
      const page = await memberCtx.newPage();
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/league/${leagueId}`);
      const card = page.locator('[data-announcements]');
      await expect(card).toBeVisible({ timeout: 20_000 });
      await expect(card).toHaveAttribute('data-announcements', '2');
      await expect(card).toContainText(`Rain-out ${stamp}`);
      await expect(card).toContainText('on the site until');
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    } finally {
      await memberCtx.close();
    }

    // The console history at 375px lists both.
    const ownerCtx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ownerCtx.newPage();
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/app/org/league/${leagueId}`);
      const history = page.locator('[data-announcement-history]');
      await expect(history).toBeVisible({ timeout: 20_000 });
      await expect(history).toHaveAttribute('data-announcement-history', '2');
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    } finally {
      await ownerCtx.close();
    }
  } finally {
    await anon.close();
    await outsiderCtx.close();
    await ownerApi.dispose();
    await alphaApi.dispose();
    await deleteQaUser(outsider.id);
    await admin.from('notifications').delete().contains('metadata', { org: `league:${leagueId}` });
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
