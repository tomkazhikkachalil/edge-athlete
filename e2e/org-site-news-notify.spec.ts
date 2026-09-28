import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { settleBody } from './helpers/isr';

// Sports-team website program, A1 (Sep 28 2026, migration 243): Announce
// merges into news. A post with "Notify members" bells every member ONCE when
// it goes live (the claim on notified_at — a repeat is a no-op); a scheduled
// post bells when its time comes (the reminders cron's sweep); "Show as a site
// banner until …" puts the post's title in the site's notice band, linking to
// the post. The composer carries both. Skips (green) without 243.

test('news notify + banner: bells once on publish, a scheduled post bells from the cron, the band links to the post', async ({ browser }) => {
  test.setTimeout(300_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json'); // the manager
  const alpha = loadQaUser('user.json'); // a member
  for (const b of ['org-site', 'org-site-pages', 'org-site-news-draft'] as const) await resetRateBucket(admin, b, owner.id);
  const probe = await admin.from('org_site_news').select('notified_at').limit(1);
  test.skip(probe.error?.code === '42703', 'org_site_news.notified_at missing — run migration 243');

  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA News Notify League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  const leagueId = league.id;
  const bellsFor = async (newsId: string) =>
    (await admin.from('notifications').select('id, title, action_url, metadata').eq('user_id', alpha.id).contains('metadata', { news_id: newsId })).data ?? [];
  try {
    await admin.from('memberships').insert([
      { org_id: leagueId, profile_id: owner.id, role: 'owner', kind: 'follow' },
      { org_id: leagueId, profile_id: alpha.id, role: 'member', kind: 'follow' },
    ]);
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = (await res.json()).site.subdomain as string;
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'set_module', moduleKey: 'news', enabled: true } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // A post with Notify + a banner, then published: the members are belled once.
    const title = `Games cancelled tonight ${stamp}`;
    res = await ownerApi.post(`/api/leagues/${leagueId}/site/news`, { data: { title } });
    const post = (await res.json()).post as { id: string; slug: string };
    const url = `/api/leagues/${leagueId}/site/news/${post.id}`;
    res = await ownerApi.patch(url, { data: { edit: { summary: 'The rink lost power.' } } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const nextYear = `${new Date().getUTCFullYear() + 1}-01-31`;
    res = await ownerApi.patch(url, { data: { notifyMembers: true, bannerUntil: nextYear } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(await bellsFor(post.id)).toHaveLength(0); // a draft never bells
    res = await ownerApi.patch(url, { data: { publish: true } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const published = (await res.json()) as { notified?: { sent: number }; post: { notified_at: string | null } };
    expect(published.notified?.sent).toBeGreaterThanOrEqual(1);
    expect(published.post.notified_at).not.toBeNull();
    const bells = await bellsFor(post.id);
    expect(bells).toHaveLength(1);
    expect(bells[0].title).toContain(title);
    expect(bells[0].action_url).toContain(`/news/${post.slug}`);
    // Once only: a repeat switch and a re-publish send nothing more.
    res = await ownerApi.patch(url, { data: { notifyMembers: true } });
    expect(res.status()).toBe(200);
    res = await ownerApi.patch(url, { data: { publish: true } });
    expect(res.status()).toBe(200);
    expect(await bellsFor(post.id)).toHaveLength(1);

    // The band: the post's title, linking to the post.
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const siteProbe = await anon.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
      const base = siteProbe.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;
      await settleBody(anon.request, base, title, true, 12);
      const page = await anon.newPage();
      await page.goto(base);
      const band = page.getByRole('status', { name: 'Notice' });
      await expect(band).toContainText(title);
      await expect(band.getByRole('link', { name: 'More →' })).toHaveAttribute('href', `${base}/news/${post.slug}`);
    } finally {
      await anon.close();
    }

    // The composer carries both controls.
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 1280, height: 900 } });
    try {
      const page = await ctx.newPage();
      await page.goto(`/app/org/league/${leagueId}/site/edit?news=${post.id}`);
      const win = page.locator('[data-larger-window="sb-news"]');
      await expect(win.locator('[data-sb-news-notified]')).toBeVisible({ timeout: 30_000 });
      await expect(win.locator('[data-sb-news-banner]')).toHaveValue(nextYear);
    } finally {
      await ctx.close();
    }

    // A scheduled post with Notify bells when its time comes (the cron's sweep).
    res = await ownerApi.post(`/api/leagues/${leagueId}/site/news`, { data: { title: `Registration opens ${stamp}` } });
    const later = (await res.json()).post as { id: string };
    const laterUrl = `/api/leagues/${leagueId}/site/news/${later.id}`;
    res = await ownerApi.patch(laterUrl, { data: { notifyMembers: true } });
    expect(res.status()).toBe(200);
    res = await ownerApi.patch(laterUrl, { data: { publishAt: new Date(Date.now() + 86_400_000).toISOString() } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(await bellsFor(later.id)).toHaveLength(0); // scheduled: not yet
    await admin.from('org_site_news').update({ published_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', later.id);
    const secret = process.env.CRON_SECRET;
    const cron = secret ? await ownerApi.get('/api/cron/reminders', { headers: { authorization: `Bearer ${secret}` } }) : null;
    test.skip(!cron || cron.status() === 401, 'CRON_SECRET does not match this target — the sweep half is skipped');
    expect(cron!.status(), await readErrorBody(cron!)).toBe(200);
    await expect.poll(async () => (await bellsFor(later.id)).length, { timeout: 15_000 }).toBe(1);

  } finally {
    await ownerApi.dispose();
    await admin.from('notifications').delete().eq('user_id', alpha.id).contains('metadata', { org: `league:${leagueId}` });
    const siteIds = ((await admin.from('org_sites').select('id').eq('org_id', leagueId)).data ?? []).map(r => r.id as string);
    if (siteIds.length) await admin.from('org_site_news').delete().in('site_id', siteIds);
    await admin.from('org_sites').delete().eq('org_id', leagueId);
    await deleteQaOrgs(admin, [leagueId]);
  }
});
