import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { settleBody, settleStatus } from './helpers/isr';

// Sports-team website program, N3 (Sep 27 2026, migration 243): the newsroom
// writer. One save model — an unpublished post's edit writes its columns; a
// LIVE post's edit lands in its draft (the public copy never shows it) until
// "Update" promotes it; every autosave is a compare-and-set on updated_at
// (a stale one is a 409 carrying the latest); Publish now or at a time (a
// future time = scheduled, off the site until then, audited as
// news_published); a tag names THIS org's team; the author is stamped.
// Skips (green) on a database without 243.

test('newsroom API: author, edits, the compare-and-set, schedule → publish, a live post’s draft → Update, the guards', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'org-site-pages', owner.id);
  await resetRateBucket(admin, 'org-site-news-draft', owner.id);
  const probe = await admin.from('org_site_news').select('draft').limit(1);
  test.skip(probe.error?.code === '42703', 'org_site_news.draft missing — run migration 243');

  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA Newsroom API League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  const other = await createQaOrg(admin, 'league', { name: `QA Newsroom Other ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  const leagueId = league.id;
  try {
    await admin.from('memberships').insert([{ org_id: leagueId, profile_id: owner.id, role: 'owner' }]);
    const { data: teams } = await admin.from('teams').insert([{ org_id: leagueId, name: `Comets ${stamp}` }, { org_id: other.id, name: `Foreign ${stamp}` }]).select('id, org_id');
    const ownTeam = teams!.find(t => t.org_id === leagueId)!.id as string;
    const foreignTeam = teams!.find(t => t.org_id === other.id)!.id as string;

    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = (await res.json()).site.subdomain as string;
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // Create: the author is stamped.
    res = await ownerApi.post(`/api/leagues/${leagueId}/site/news`, { data: { title: `Draft ${stamp}` } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const created = (await res.json()).post as { id: string; slug: string };
    const url = `/api/leagues/${leagueId}/site/news/${created.id}`;
    let got = (await (await ownerApi.get(url)).json()) as { post: Record<string, unknown>; state: string };
    expect(got.post.created_by).toBe(owner.id);
    expect(got.state).toBe('draft');

    // An edit on an unpublished post writes the columns (the one save model).
    res = await ownerApi.patch(url, {
      data: {
        edit: { title: `Game night ${stamp}`, summary: 'Doors at six.', teamId: ownTeam, body: [{ type: 'paragraph', text: 'First words.' }] },
        expectUpdatedAt: got.post.updated_at,
      },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    let out = (await res.json()) as { post: Record<string, unknown>; state: string };
    expect(out.post).toMatchObject({ title: `Game night ${stamp}`, summary: 'Doors at six.', team_id: ownTeam, draft: null });
    const fresh = out.post.updated_at as string;

    // A stale save is a 409 carrying the latest (never a silent overwrite).
    res = await ownerApi.patch(url, { data: { edit: { title: 'Stale' }, expectUpdatedAt: got.post.updated_at } });
    expect(res.status()).toBe(409);
    const conflict = (await res.json()) as { code: string; post: Record<string, unknown> };
    expect(conflict.code).toBe('conflict');
    expect(conflict.post.title).toBe(`Game night ${stamp}`);

    // The guards: another org's team; a foreign cover; team AND division.
    res = await ownerApi.patch(url, { data: { edit: { teamId: foreignTeam } } });
    expect(res.status()).toBe(400);
    res = await ownerApi.patch(url, { data: { edit: { coverPath: 'org-media/00000000-0000-0000-0000-000000000000/x.jpg' } } });
    expect(res.status()).toBe(400);
    res = await ownerApi.patch(url, { data: { edit: { teamId: ownTeam, divisionId: ownTeam } } });
    expect(res.status()).toBe(400);

    // Schedule a week ahead: off the site, audited as news_published (scheduled).
    const weekAhead = new Date(Date.now() + 7 * 86_400_000).toISOString();
    res = await ownerApi.patch(url, { data: { publishAt: weekAhead, expectUpdatedAt: fresh } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    out = await res.json();
    expect(out.state).toBe('scheduled');
    const { data: audit } = await admin.from('authority_audit').select('action, detail').eq('subject_id', leagueId).eq('action', 'news_published');
    expect(audit?.some(a => (a.detail as { status?: string; news_id?: string }).status === 'scheduled' && (a.detail as { news_id?: string }).news_id === created.id)).toBe(true);

    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const siteProbe = await anon.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
      const base = siteProbe.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;
      expect(await settleStatus(anon.request, `${base}/news/${created.slug}`, 404)).toBe(404);

      // Publish now overrides the schedule.
      res = await ownerApi.patch(url, { data: { publish: true } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      out = await res.json();
      expect(out.state).toBe('live');
      await settleBody(anon.request, `${base}/news/${created.slug}`, `Game night ${stamp}`, true, 12);

      // Editing the LIVE post lands in its draft — the public copy is untouched.
      got = (await (await ownerApi.get(url)).json()) as typeof got;
      res = await ownerApi.patch(url, { data: { edit: { title: `Game night — updated ${stamp}` }, expectUpdatedAt: got.post.updated_at } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      out = await res.json();
      expect(out.post.title).toBe(`Game night ${stamp}`);
      expect((out.post.draft as { title?: string }).title).toBe(`Game night — updated ${stamp}`);
      const stillOld = await (await anon.request.get(`${base}/news/${created.slug}`)).text();
      expect(stillOld).not.toContain(`Game night — updated ${stamp}`);

      // Update promotes the draft.
      res = await ownerApi.patch(url, { data: { promote: true } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      out = await res.json();
      expect(out.post).toMatchObject({ title: `Game night — updated ${stamp}`, draft: null });
      await settleBody(anon.request, `${base}/news/${created.slug}`, `Game night — updated ${stamp}`, true, 12);
    } finally {
      await anon.close();
    }
  } finally {
    await ownerApi.dispose();
    const siteIds = ((await admin.from('org_sites').select('id').eq('org_id', leagueId)).data ?? []).map(r => r.id as string);
    if (siteIds.length) await admin.from('org_site_news').delete().in('site_id', siteIds);
    await admin.from('org_sites').delete().eq('org_id', leagueId);
    await deleteQaOrgs(admin, [leagueId, other.id]);
  }
});
