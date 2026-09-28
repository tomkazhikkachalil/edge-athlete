import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { settleBody, settleStatus } from './helpers/isr';

// Sports-team website program, N1 (Sep 27 2026): the newsroom's floor —
// (1) a post whose `published_at` is in the future is NOT published yet: the
// list, the post's own page and the sitemap all fence `published_at <= now`
// (the scheduling UI arrives with the newsroom in the editor); (2) a
// paragraph's **bold** and [link](https://…) render as elements, parsed —
// never HTML — and a non-https link stays literal text; the excerpt is words.

test('news: a future-dated post stays off the site until its time; **bold** and https links render, anything else stays text', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  await resetRateBucket(admin, 'org-site', owner.id);
  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA Newsroom League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  const leagueId = league.id;
  try {
    await admin.from('memberships').insert([{ org_id: leagueId, profile_id: owner.id, role: 'owner' }]);
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = (await res.json()).site.subdomain as string;
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // A formatted post, published now.
    res = await ownerApi.post(`/api/leagues/${leagueId}/site/news`, { data: { title: `Opening night ${stamp}` } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const live = (await res.json()).post as { id: string; slug: string };
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site/news/${live.id}`, {
      data: {
        body: [{ type: 'paragraph', text: `Game **tonight ${stamp}** — [tickets](https://example.com/tickets) and [bad](javascript:alert(1)) <b>raw</b>` }],
        publish: true,
      },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // A second post, then dated a week ahead (the scheduling UI comes later —
    // the fence is what this proves).
    res = await ownerApi.post(`/api/leagues/${leagueId}/site/news`, { data: { title: `Scheduled ${stamp}` } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const later = (await res.json()).post as { id: string; slug: string };
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site/news/${later.id}`, { data: { body: [{ type: 'paragraph', text: 'Next week.' }], publish: true } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const weekAhead = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const { error: dateError } = await admin.from('org_site_news').update({ published_at: weekAhead }).eq('id', later.id);
    expect(dateError).toBeNull();

    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const probe = await anon.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
      const base = probe.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;

      // (1) The fence: the live post lists, the scheduled one does not.
      const list = await settleBody(anon.request, `${base}/news`, `Opening night ${stamp}`, true, 12);
      expect(list).not.toContain(`Scheduled ${stamp}`);
      expect(await settleStatus(anon.request, `${base}/news/${later.slug}`, 404)).toBe(404);
      // The excerpt is words — no markup characters.
      expect(list).toContain(`Game tonight ${stamp} — tickets`);
      expect(list).not.toContain(`**tonight ${stamp}**`);

      // (2) The post page: bold and the https link are elements; the rest is text.
      const page = await anon.newPage();
      await page.goto(`${base}/news/${live.slug}`);
      await expect(page.locator('strong', { hasText: `tonight ${stamp}` })).toBeVisible();
      const link = page.getByRole('link', { name: 'tickets', exact: true });
      await expect(link).toHaveAttribute('href', 'https://example.com/tickets');
      await expect(link).toHaveAttribute('rel', 'nofollow ugc noopener');
      await expect(page.getByText('[bad](javascript:alert(1)) <b>raw</b>')).toBeVisible();
      await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);

      // Its time comes: moved into the past, the scheduled post appears.
      const { error: pastError } = await admin.from('org_site_news').update({ published_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', later.id);
      expect(pastError).toBeNull();
      // The list is cached (≤ 5 min on a real host, no cron needed); an edit
      // purges the site tag, so a title save stands in for the wait here.
      res = await ownerApi.patch(`/api/leagues/${leagueId}/site/news/${later.id}`, { data: { title: `Scheduled ${stamp}` } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      await settleBody(anon.request, `${base}/news`, `Scheduled ${stamp}`, true, 12);
      expect(await settleStatus(anon.request, `${base}/news/${later.slug}`, 200)).toBe(200);
    } finally {
      await anon.close();
    }
  } finally {
    await ownerApi.dispose();
    await admin.from('org_site_news').delete().in('site_id', (await admin.from('org_sites').select('id').eq('org_id', leagueId)).data?.map(r => r.id as string) ?? []);
    await admin.from('org_sites').delete().eq('org_id', leagueId);
    await deleteQaOrgs(admin, [leagueId]);
  }
});
