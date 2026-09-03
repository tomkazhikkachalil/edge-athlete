import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, resetRateBucket } from './helpers/qa-user';

// Phase 9 V5 — public items on a private site. A news post carries an
// audience (176): a PRIVATE club's site lists public posts only and its
// members-only post is indistinguishable from missing; members read every
// published post in the app (the club page's news card via /news/mine);
// a public club shows everything on the site. The editor's audience
// control PATCHes it; the console list shows the chip. 375px.

const stamp = Math.random().toString(36).slice(2, 8);

async function readErrorBody(res: { text: () => Promise<string> }): Promise<string> {
  return (await res.text()).slice(0, 300);
}

test('news audience: private site lists public posts only, members read both in the app; public club shows both; editor + chip; 375px', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const alpha = loadQaUser('user.json'); // a member
  await resetRateBucket(admin, 'org-site', owner.id);
  const probe = await admin.from('org_site_news').select('audience').limit(1);
  test.skip(!!probe.error, `news audience missing — run migration 176 (${probe.error?.message})`);

  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA News Club ${stamp}`, owner_profile_id: owner.id, primary_sport: 'golf', visibility: 'private' })
    .select('id')
    .single();
  const clubId = club!.id as string;
  await admin.from('memberships').insert([
    { club_id: clubId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { club_id: clubId, profile_id: alpha.id, role: 'member', kind: 'follow' },
  ]);

  const ownerApi = await apiAs('state-b.json');
  const alphaApi = await apiAs('state.json');
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    let res = await ownerApi.post(`/api/clubs/${clubId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = ((await res.json()).site as { subdomain: string }).subdomain;
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // Two posts: a public one and a members-only one, both published.
    const makePost = async (title: string, audience: 'public' | 'members') => {
      let r = await ownerApi.post(`/api/clubs/${clubId}/site/news`, { data: { title } });
      expect(r.status(), await readErrorBody(r)).toBe(200);
      const post = (await r.json()).post as { id: string; slug: string };
      r = await ownerApi.patch(`/api/clubs/${clubId}/site/news/${post.id}`, {
        data: { body: [{ type: 'paragraph', text: `${title} body ${stamp}` }], publish: true, audience },
      });
      expect(r.status(), await readErrorBody(r)).toBe(200);
      expect(((await r.json()).post as { audience: string }).audience).toBe(audience);
      return post;
    };
    const pub = await makePost(`Open day ${stamp}`, 'public');
    const secret = await makePost(`Members meeting ${stamp}`, 'members');

    // The private site: the public post only; the members-only post's URL is a 404.
    let list = '';
    await expect
      .poll(async () => { const r = await anon.request.get(`/org/${subdomain}/news`); list = r.ok() ? await r.text() : ''; return list.includes(`Open day ${stamp}`); }, { timeout: 30_000, intervals: [1000, 2000, 3000] })
      .toBe(true);
    expect(list).not.toContain(`Members meeting ${stamp}`);
    expect((await anon.request.get(`/org/${subdomain}/news/${pub.slug}`)).status()).toBe(200);
    expect((await anon.request.get(`/org/${subdomain}/news/${secret.slug}`)).status()).toBe(404);

    // Members read both in the app; a non-member reads nothing.
    res = await alphaApi.get(`/api/clubs/${clubId}/news/mine`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(res.headers()['cache-control']).toContain('private');
    const mine = (await res.json()) as { posts: { slug: string; audience: string; blocks: { type: string; text?: string }[] }[] };
    expect(mine.posts.map(p => p.slug).sort()).toEqual([pub.slug, secret.slug].sort());
    expect(mine.posts.find(p => p.slug === secret.slug)?.blocks[0]).toEqual({ type: 'paragraph', text: `Members meeting ${stamp} body ${stamp}` });
    expect((await anon.request.get(`/api/clubs/${clubId}/news/mine`)).status()).toBe(401);

    // The member's club page at 375px: the card lists both, the members-only body expands.
    const memberCtx = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport: { width: 375, height: 812 } });
    try {
      const mp = await memberCtx.newPage();
      await mp.goto(`/club/${clubId}`);
      const card = mp.locator('[data-club-news]');
      await expect(card).toBeVisible({ timeout: 20_000 });
      await expect(card.getByText(`Members meeting ${stamp}`)).toBeVisible();
      await expect(card.getByText('members only')).toBeVisible();
      await card.getByRole('button', { name: `Members meeting ${stamp}` }).click();
      await expect(mp.locator(`[data-news-body="${secret.slug}"]`)).toContainText(`body ${stamp}`);
      expect(await mp.evaluate(() => document.documentElement.scrollWidth), 'club page: no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    } finally {
      await memberCtx.close();
    }

    // The console: the chip; the editor's audience control flips it to public.
    const ownerCtx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 375, height: 812 } });
    try {
      const op = await ownerCtx.newPage();
      await op.goto(`/app/org/club/${clubId}`);
      await expect(op.locator('[data-news-audience="members"]')).toHaveCount(1, { timeout: 20_000 });
      await op.goto(`/app/org/club/${clubId}/site/news/${secret.id}`);
      const audience = op.getByLabel('Post audience');
      await expect(audience).toHaveValue('members', { timeout: 20_000 });
      await audience.selectOption('public');
      await expect(op.getByText('Public — shown on the site')).toBeVisible({ timeout: 15_000 });
      expect(await op.evaluate(() => document.documentElement.scrollWidth), 'editor: no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    } finally {
      await ownerCtx.close();
    }
    await expect
      .poll(async () => (await admin.from('org_site_news').select('audience').eq('id', secret.id).single()).data?.audience, { timeout: 10_000 })
      .toBe('public');
    // …and the site now lists it (the PATCH purged the tag).
    await expect
      .poll(async () => (await (await anon.request.get(`/org/${subdomain}/news`)).text()).includes(`Members meeting ${stamp}`), { timeout: 30_000, intervals: [1500, 3000] })
      .toBe(true);

    // A PUBLIC club shows a members-only post on its site too (the audience only bites when private).
    res = await ownerApi.patch(`/api/clubs/${clubId}/site/news/${secret.id}`, { data: { audience: 'members' } });
    expect(res.status()).toBe(200);
    res = await ownerApi.patch(`/api/clubs/${clubId}`, { data: { visibility: 'public' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    await expect
      .poll(async () => (await (await anon.request.get(`/org/${subdomain}/news`)).text()).includes(`Members meeting ${stamp}`), { timeout: 30_000, intervals: [1500, 3000] })
      .toBe(true);
  } finally {
    await anon.close();
    await ownerApi.dispose();
    await alphaApi.dispose();
    await admin.from('clubs').delete().eq('id', clubId);
  }
});
