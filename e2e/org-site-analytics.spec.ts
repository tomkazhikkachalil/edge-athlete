import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Program 2, E1 (Sep 11 2026): the first-party page-view pixel. A live site's
// pages carry the pixel; two fetches of it from one browser (the same
// user-agent, the home as the referer) count two views and ONE visitor for
// the day; a subpage referer keys its own row; an opted-out fetch (Sec-GPC),
// a bot user-agent, a cross-origin referer and a preview referer count
// nothing; the pixel is a no-store GIF every time. Skips until migration
// 188 has run (and needs ANALYTICS_SALT on the server).

test('org site analytics: the pixel counts views and daily visitors, honours opt-out, bots, foreign and preview referers', async ({ browser }) => {
  test.setTimeout(180_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name: `QA Pixel League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert([{ league_id: leagueId, profile_id: owner.id, role: 'owner' }]);
  try {
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { subdomain, id: siteId } = (await res.json()).site as { subdomain: string; id: string };
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { error: probeError } = await admin.from('org_site_stats_daily').select('site_id').limit(1);
    test.skip(!!probeError, 'org_site_stats_daily missing — run migration 188');

    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const pathFor = async (sub: string) => {
        const probe = await anon.request.get(`/org/${sub}`, { maxRedirects: 0 });
        return probe.status() === 301 ? `/${sub}` : `/org/${sub}`;
      };
      const base = await pathFor(subdomain);
      const origin = new URL((await anon.request.get(base)).url()).origin;
      // The page carries the pixel.
      const html = await (await anon.request.get(base)).text();
      expect(html).toContain(`src="${base}/hit.gif"`);
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1';
      const hit = (referer: string | null, extra: Record<string, string> = {}, agent = ua) =>
        anon.request.get(`${base}/hit.gif`, { headers: { 'user-agent': agent, ...(referer ? { referer } : {}), ...extra } });
      // Two views from one browser on the home, one on the standings page.
      const first = await hit(`${origin}${base}`);
      expect(first.status()).toBe(200);
      expect(first.headers()['content-type']).toContain('image/gif');
      expect(first.headers()['cache-control']).toContain('no-store');
      await hit(`${origin}${base}`);
      await hit(`${origin}${base}/standings`);
      // Nothing from: an opted-out browser, a bot, a foreign referer, a preview referer, no referer.
      await hit(`${origin}${base}`, { 'sec-gpc': '1' });
      await hit(`${origin}${base}`, {}, 'Mozilla/5.0 (compatible; Googlebot/2.1)');
      await hit('https://elsewhere.example/page');
      await hit(`${origin}${base}/preview/abc123`);
      await hit(null);
      const day = new Date().toISOString().slice(0, 10);
      await expect
        .poll(async () => {
          const { data } = await admin.from('org_site_stats_daily').select('path, views, visitors').eq('site_id', siteId).eq('day', day).order('path');
          return data;
        }, { timeout: 15_000 })
        .toEqual([
          { path: '/', views: 2, visitors: 1 },
          { path: '/standings', views: 1, visitors: 0 },
        ]);
      // The mark is a hash — never the ip or the agent.
      const { data: marks } = await admin.from('org_site_hit_marks').select('visitor_hash').eq('site_id', siteId).eq('day', day);
      expect(marks).toHaveLength(1);
      expect(marks![0].visitor_hash).toMatch(/^[0-9a-f]{32}$/);
      expect(marks![0].visitor_hash).not.toContain('iPhone');
    } finally {
      await anon.close();
    }
  } finally {
    await ownerApi.dispose();
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
