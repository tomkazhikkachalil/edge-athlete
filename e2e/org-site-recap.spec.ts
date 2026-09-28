import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Sports-team website program, R1 (Sep 28 2026): one-click recap drafts. A
// finished game shows under the newsroom's "From results"; one click drafts
// its recap (the winner leads the headline, the score home-first), a second
// click — or a racing tab — lands on the SAME draft (243's source_ref
// UNIQUE); a private competition's game drafts for members; nothing is
// public until the manager publishes. The ?news=recap:<id> link opens it.

test('recap drafts: from results → a draft once, deduped, members-only for a private game; the deep link opens it @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  const probe = await admin.from('org_site_news').select('source_ref').limit(1);
  test.skip(probe.error?.code === '42703', 'org_site_news.source_ref missing — run migration 243');
  for (const b of ['org-site', 'org-site-pages'] as const) await resetRateBucket(admin, b, owner.id);
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA Recap League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  await admin.from('memberships').insert([{ org_id: league.id, profile_id: owner.id, kind: 'follow', role: 'owner', status: 'active' }]);
  const ownerApi = await apiAs('state-b.json');
  try {
    let res = await ownerApi.post(`/api/leagues/${league.id}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { subdomain } = (await res.json()).site as { subdomain: string };
    res = await ownerApi.patch(`/api/leagues/${league.id}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    const { data: season } = await admin.from('seasons').insert({ org_id: league.id, label: `RC ${stamp}` }).select('id').single();
    const { data: teams } = await admin.from('teams').insert([{ org_id: league.id, name: `Comets ${stamp}` }, { org_id: league.id, name: `Blazers ${stamp}` }]).select('id, name');
    const comets = teams!.find(t => (t.name as string).startsWith('Comets'))!.id as string;
    const blazers = teams!.find(t => (t.name as string).startsWith('Blazers'))!.id as string;
    const game = async (name: string, visibility: 'public' | 'private', scores: [number, number]) => {
      const { data: comp } = await admin.from('competitions').insert({ org_id: league.id, season_id: season!.id, sport_key: 'ice_hockey', name, format: 'fixture', entrant_type: 'team', status: 'active', visibility }).select('id').single();
      const { data: entries } = await admin.from('competition_entries').insert([
        { competition_id: comp!.id, team_id: comets, status: 'approved' },
        { competition_id: comp!.id, team_id: blazers, status: 'approved' },
      ]).select('id, team_id');
      const cE = entries!.find(e => e.team_id === comets)!.id;
      const bE = entries!.find(e => e.team_id === blazers)!.id;
      const { data: contest } = await admin.from('contests').insert({ competition_id: comp!.id, status: 'completed', scheduled_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), round: 'Week 3' }).select('id').single();
      const { data: parts } = await admin.from('contest_participants').insert([
        { contest_id: contest!.id, entry_id: cE, side: 'home' },
        { contest_id: contest!.id, entry_id: bE, side: 'away' },
      ]).select('id, entry_id');
      await admin.from('contest_results').insert([
        { contest_id: contest!.id, participant_id: parts!.find(p => p.entry_id === cE)!.id, score: scores[0] },
        { contest_id: contest!.id, participant_id: parts!.find(p => p.entry_id === bE)!.id, score: scores[1] },
      ]);
      return contest!.id as string;
    };
    const open = await game(`Open Cup ${stamp}`, 'public', [2, 3]);
    const secret = await game(`Secret Cup ${stamp}`, 'private', [4, 1]);

    // The candidates: both finished games, home-first, not yet recapped.
    res = await ownerApi.get(`/api/leagues/${league.id}/site/news/recap`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const list = (await res.json()) as { supported: boolean; candidates: { contestId: string; title: string; recapNewsId: string | null }[] };
    expect(list.supported).toBe(true);
    expect(list.candidates.find(c => c.contestId === open)).toMatchObject({ title: `Comets ${stamp} 2–3 Blazers ${stamp}`, recapNewsId: null });
    expect(list.candidates.some(c => c.contestId === secret)).toBe(true);

    // One click: a DRAFT with the winner leading; a second click: the same draft.
    res = await ownerApi.post(`/api/leagues/${league.id}/site/news/recap`, { data: { contestId: open } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const first = (await res.json()) as { post: { id: string; title: string }; existing: boolean };
    expect(first.existing).toBe(false);
    expect(first.post.title).toBe(`Blazers ${stamp} beat Comets ${stamp} 3–2`);
    const [again, racing] = await Promise.all([
      ownerApi.post(`/api/leagues/${league.id}/site/news/recap`, { data: { contestId: open } }),
      ownerApi.post(`/api/leagues/${league.id}/site/news/recap`, { data: { contestId: open } }),
    ]);
    for (const r of [again, racing]) {
      expect(r.status(), await readErrorBody(r)).toBe(200);
      expect(((await r.json()) as { post: { id: string } }).post.id).toBe(first.post.id);
    }
    const { data: row } = await admin.from('org_site_news').select('published_at, audience, source_ref, summary').eq('id', first.post.id).single();
    expect(row).toMatchObject({ published_at: null, audience: 'public', source_ref: `contest:${open}` });
    expect(row!.summary).toContain(`Comets ${stamp} 2–3 Blazers ${stamp}`);
    // A private competition's game drafts for members.
    res = await ownerApi.post(`/api/leagues/${league.id}/site/news/recap`, { data: { contestId: secret } });
    const priv = (await res.json()) as { post: { id: string } };
    expect((await admin.from('org_site_news').select('audience').eq('id', priv.post.id).single()).data!.audience).toBe('members');
    // Another org's game (or a made-up id) is not this org's to recap.
    res = await ownerApi.post(`/api/leagues/${league.id}/site/news/recap`, { data: { contestId: '6a1f5b0e-1c2d-4e3f-8a9b-0c1d2e3f4a5b' } });
    expect(res.status()).toBe(404);

    // Nothing public: the draft is not on the site.
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const html = await (await anon.request.get(`/org/${subdomain}/news`)).text();
      expect(html).not.toContain(`beat Comets ${stamp}`);
    } finally {
      await anon.close();
    }

    // The editor at phone width: From results says the recap exists; the deep link opens it.
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 390, height: 844 } });
    try {
      const page = await ctx.newPage();
      page.setDefaultTimeout(20_000);
      await page.goto(`/app/org/league/${league.id}/site/edit?news=list`);
      const win = page.locator('[data-larger-window="sb-news"]');
      await expect(win.locator(`[data-sb-news-recap="${open}"] [data-sb-news-recap-open]`)).toBeVisible({ timeout: 30_000 });
      await page.goto(`/app/org/league/${league.id}/site/edit?news=recap:${open}`);
      await expect(win.locator(`[data-sb-news-composer="${first.post.id}"]`)).toBeVisible({ timeout: 30_000 });
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 390px').toBeLessThanOrEqual(390);
    } finally {
      await ctx.close();
    }
  } finally {
    await ownerApi.dispose();
    const siteIds = ((await admin.from('org_sites').select('id').eq('org_id', league.id)).data ?? []).map(r => r.id as string);
    if (siteIds.length) await admin.from('org_site_news').delete().in('site_id', siteIds);
    await admin.from('org_sites').delete().eq('org_id', league.id);
    await deleteQaOrgs(admin, [league.id]);
  }
});
