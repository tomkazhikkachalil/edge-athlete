import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { cleanRoundPost, seedRoundPost } from './helpers/member-photos';

// M2 (program 10), part 2 — member photos on the site. A picked photo
// renders on the public gallery through the gated tokenless streamer
// (the member's player page strip rides org-site-players.spec); the gate re-runs per request: a
// consent revoke, the post made private, or the club gone private stops
// the bytes at once (the tile follows on the ISR clock). 375px.

const stamp = Math.random().toString(36).slice(2, 8);

test('member photos on the site: gallery tile + streamer + player page; revoke → 404; private post → 404; private club → 404; 375px', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const alpha = loadQaUser('user.json'); // the member
  await resetRateBucket(admin, 'org-site', owner.id);

  const { data: alphaProfile } = await admin.from('profiles').select('visibility, handle, first_name').eq('id', alpha.id).single();
  const priorVisibility = alphaProfile!.visibility as string;
  const priorHandle = (alphaProfile!.handle as string | null) ?? null;
  const handle = `qaphotos${stamp}`;
  await admin.from('profiles').update({ visibility: 'public', handle }).eq('id', alpha.id);

  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA Photos Club ${stamp}`, owner_profile_id: owner.id, primary_sport: 'golf' })
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
  let seed: Awaited<ReturnType<typeof seedRoundPost>> | null = null;
  try {
    let res = await ownerApi.post(`/api/clubs/${clubId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const site = (await res.json()).site as { id: string; subdomain: string };
    for (const moduleKey of ['gallery', 'standings']) {
      res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'set_module', moduleKey, enabled: true } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
    }

    // Consent FIRST, then the post, then the pick, then publish.
    res = await alphaApi.patch(`/api/clubs/${clubId}/photo-consent`, { data: { consent: true } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    seed = await seedRoundPost(admin, alpha.id, { stamp, visibility: 'public', course: `QA Pines ${stamp}` });
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'set_gallery_pick', mediaId: seed.mediaId } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const streamer = `/api/media/org-gallery/${site.id}/${seed.mediaId}`;
    // Not live yet → the streamer refuses even with the pick.
    expect((await anon.request.get(streamer)).status()).toBe(404);
    // Vercel's CDN keeps a streamer 200 for its short s-maxage (the
    // documented ≤5-minute lag, the contest-media precedent) — every
    // post-change check below asks a FRESH URL so the gate itself is what
    // answers (the route ignores the query).
    const fresh = () => `${streamer}?t=${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // The gallery tile + the bytes.
    const galleryUrl = `/org/${site.subdomain}/gallery`;
    let html = '';
    await expect
      .poll(async () => { const r = await anon.request.get(galleryUrl); html = r.ok() ? await r.text() : ''; return html.includes(streamer); }, { timeout: 30_000, intervals: [1000, 2000, 3000] })
      .toBe(true);
    expect(html).toContain(`QA Pines ${stamp}`);
    expect(html).toContain(alphaProfile!.first_name as string); // a public profile's real first name
    const bytes = await anon.request.get(streamer);
    expect(bytes.status()).toBe(200);
    expect(bytes.headers()['content-type'] ?? '').toContain('image/png');
    expect(bytes.headers()['cache-control'] ?? '').not.toContain('86400'); // the SHORT shared cache

    // (The player page's photo strip is asserted in org-site-players.spec.ts —
    // a player page exists only for a member in a golf leaderboard.)

    // Revoke → the streamer 404s at once; the tile leaves on revalidate.
    res = await alphaApi.patch(`/api/clubs/${clubId}/photo-consent`, { data: { consent: false } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await anon.request.get(fresh())).status()).toBe(404);
    await expect
      .poll(async () => { const r = await anon.request.get(galleryUrl); return r.ok() ? !(await r.text()).includes(streamer) : false; }, { timeout: 30_000, intervals: [1000, 2000, 3000] })
      .toBe(true);
    res = await alphaApi.patch(`/api/clubs/${clubId}/photo-consent`, { data: { consent: true } });
    expect(res.status()).toBe(200);
    expect((await anon.request.get(fresh())).status()).toBe(200);

    // The post made private → 404; public again → 200.
    await admin.from('posts').update({ visibility: 'private' }).eq('id', seed.postId);
    expect((await anon.request.get(fresh())).status()).toBe(404);
    await admin.from('posts').update({ visibility: 'public' }).eq('id', seed.postId);
    expect((await anon.request.get(fresh())).status()).toBe(200);

    // The club gone private → 404 even with the pick (the phase-9 rail).
    res = await ownerApi.patch(`/api/clubs/${clubId}`, { data: { visibility: 'private' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await anon.request.get(fresh())).status()).toBe(404);
    res = await ownerApi.patch(`/api/clubs/${clubId}`, { data: { visibility: 'public' } });
    expect(res.status()).toBe(200);

    // 375px: the gallery grid.
    const page = await anon.newPage();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(galleryUrl);
    await expect(page.locator(`img[src="${streamer}"]`)).toBeVisible({ timeout: 20_000 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
  } finally {
    await anon.close();
    await ownerApi.dispose();
    await alphaApi.dispose();
    await cleanRoundPost(admin, seed);
    await admin.from('clubs').delete().eq('id', clubId);
    await admin.from('profiles').update({ visibility: priorVisibility, handle: priorHandle }).eq('id', alpha.id);
  }
});
