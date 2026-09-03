import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { adminClient, apiAs, loadQaUser, resetRateBucket } from './helpers/qa-user';

// N1 (program 10) — news covers. A post's cover is DERIVED from its first
// image block (no column): the /news list shows a thumbnail per covered
// post, the home's news module renders a "Latest news" teaser (it used
// to say "Coming soon."), and the post's og:image is the cover through
// the ABSOLUTE org-media streamer (bytes 200) — a post without an image
// keeps the org card. 375px on the list.

const stamp = Math.random().toString(36).slice(2, 8);

async function readErrorBody(res: { text: () => Promise<string> }): Promise<string> {
  return (await res.text()).slice(0, 300);
}

test('news covers: list thumbnail + home teaser + og:image from the first image block; no image → the card; 375px', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'upload', owner.id);
  const probe = await admin.from('org_site_news').select('id').limit(1);
  test.skip(!!probe.error, `org_site_news missing — run migration 156 (${probe.error?.message})`);

  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA Cover Club ${stamp}`, owner_profile_id: owner.id, primary_sport: 'golf' })
    .select('id')
    .single();
  const clubId = club!.id as string;
  await admin.from('memberships').insert([{ club_id: clubId, profile_id: owner.id, role: 'owner', kind: 'follow' }]);
  const ownerApi = await apiAs('state-b.json');
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  let assetPath = '';
  try {
    let res = await ownerApi.post(`/api/clubs/${clubId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const site = (await res.json()).site as { id: string; subdomain: string };
    const { subdomain } = site;
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    // The news module must be on for the home teaser + /news.
    const { data: mod } = await admin.from('org_site_modules').select('enabled').eq('site_id', site.id).eq('module_key', 'news').maybeSingle();
    if (!mod?.enabled) {
      res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'set_module', moduleKey: 'news', enabled: true } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
    }

    // A site asset (the page-image upload) becomes the first block.
    const photo = fs.readFileSync(path.join(__dirname, 'fixtures', 'photo.png'));
    res = await ownerApi.post(`/api/clubs/${clubId}/site/assets`, {
      multipart: { image: { name: 'cover.png', mimeType: 'image/png', buffer: photo } },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    assetPath = (await res.json()).path as string;
    expect(assetPath.startsWith(`org-media/${site.id}/`)).toBe(true);

    const makePost = async (title: string, withImage: boolean) => {
      let r = await ownerApi.post(`/api/clubs/${clubId}/site/news`, { data: { title } });
      expect(r.status(), await readErrorBody(r)).toBe(200);
      const post = (await r.json()).post as { id: string; slug: string };
      const body = [
        ...(withImage ? [{ type: 'image', path: assetPath, alt: `Cover ${stamp}`, width: 640, height: 360 }] : []),
        { type: 'paragraph', text: `${title} body ${stamp}` },
      ];
      r = await ownerApi.patch(`/api/clubs/${clubId}/site/news/${post.id}`, { data: { body, publish: true } });
      expect(r.status(), await readErrorBody(r)).toBe(200);
      return post;
    };
    const covered = await makePost(`Opening day ${stamp}`, true);
    const plain = await makePost(`Rules reminder ${stamp}`, false);

    // The list: a thumbnail for the covered post only.
    let list = '';
    await expect
      .poll(async () => { const r = await anon.request.get(`/org/${subdomain}/news`); list = r.ok() ? await r.text() : ''; return list.includes(`data-news-cover="${covered.slug}"`); }, { timeout: 30_000, intervals: [1000, 2000, 3000] })
      .toBe(true);
    expect(list).toContain(`Rules reminder ${stamp}`);
    expect(list).not.toContain(`data-news-cover="${plain.slug}"`);
    const streamer = `/api/media/org-media/${site.id}/${assetPath.split('/').pop()}`;
    expect(list).toContain(streamer);

    // The post's og:image = the cover through the absolute streamer URL; bytes 200.
    const postHtml = await (await anon.request.get(`/org/${subdomain}/news/${covered.slug}`)).text();
    const og = postHtml.match(/property="og:image" content="([^"]+)"/);
    expect(og, 'og:image present').toBeTruthy();
    expect(og![1]).toContain(streamer);
    const bytes = await anon.request.get(og![1]);
    expect(bytes.status(), await readErrorBody(bytes)).toBe(200);
    expect(bytes.headers()['content-type'] ?? '').toContain('image/');
    // No image → the org card, as before.
    const plainHtml = await (await anon.request.get(`/org/${subdomain}/news/${plain.slug}`)).text();
    const plainOg = plainHtml.match(/property="og:image" content="([^"]+)"/);
    expect(plainOg![1]).toContain('/card.png');

    // The home's news module: the teaser with the cover, not "Coming soon.".
    let home = '';
    await expect
      .poll(async () => { const r = await anon.request.get(`/org/${subdomain}`); home = r.ok() ? await r.text() : ''; return home.includes('data-home-news='); }, { timeout: 30_000, intervals: [1000, 2000, 3000] })
      .toBe(true);
    expect(home).toContain(`data-news-cover="${covered.slug}"`);
    expect(home).toContain('All news');

    // 375px: the list with thumbnails never overflows.
    const page = await anon.newPage();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/org/${subdomain}/news`);
    await expect(page.locator(`[data-news-cover="${covered.slug}"] img`)).toBeVisible({ timeout: 20_000 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
  } finally {
    await anon.close();
    await ownerApi.dispose();
    await admin.from('clubs').delete().eq('id', clubId);
    if (assetPath) await admin.storage.from('uploads').remove([assetPath]);
  }
});
