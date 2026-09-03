import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { adminClient, apiAs, loadQaUser, resetRateBucket } from './helpers/qa-user';

// N2 (program 10) — the share card draws the hero photo. A site with a
// hero image (S1 set_hero imagePath, a site asset) renders card.png
// with the photo under a gradient; a site without one keeps the plain
// gradient card. Both answer 200 image/png with the hour cache; the two
// PNGs differ (the photo card is a different picture). On prod the CDN
// caches card.png for an hour, so the hero is set BEFORE the card's
// first fetch.

const stamp = Math.random().toString(36).slice(2, 8);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

async function readErrorBody(res: { text: () => Promise<string> }): Promise<string> {
  return (await res.text()).slice(0, 300);
}

test('share card: hero photo drawn when set; plain gradient otherwise; both PNG with the hour cache', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'upload', owner.id);

  const make = async (suffix: string) => {
    const { data: club } = await admin
      .from('clubs')
      .insert({ name: `QA Card Club ${suffix} ${stamp}`, owner_profile_id: owner.id, primary_sport: 'golf' })
      .select('id')
      .single();
    const id = club!.id as string;
    await admin.from('memberships').insert([{ club_id: id, profile_id: owner.id, role: 'owner', kind: 'follow' }]);
    return id;
  };
  const heroClub = await make('Hero');
  const plainClub = await make('Plain');
  const ownerApi = await apiAs('state-b.json');
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  let assetPath = '';
  try {
    const publish = async (clubId: string) => {
      let res = await ownerApi.post(`/api/clubs/${clubId}/site`);
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const site = (await res.json()).site as { id: string; subdomain: string };
      res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'publish' } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      return site;
    };
    const heroSite = await publish(heroClub);
    const plainSite = await publish(plainClub);

    // The hero photo: a site asset → set_hero BEFORE the card is ever fetched.
    const photo = fs.readFileSync(path.join(__dirname, 'fixtures', 'photo.png'));
    let res = await ownerApi.post(`/api/clubs/${heroClub}/site/assets`, {
      multipart: { image: { name: 'hero.png', mimeType: 'image/png', buffer: photo } },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    assetPath = (await res.json()).path as string;
    res = await ownerApi.patch(`/api/clubs/${heroClub}/site`, {
      data: { action: 'set_hero', headline: `Play here ${stamp}`, imagePath: assetPath, imageAlt: 'The first tee' },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    const card = async (subdomain: string) => {
      const r = await anon.request.get(`/org/${subdomain}/card.png`);
      expect(r.status(), `card for ${subdomain}`).toBe(200);
      expect(r.headers()['content-type'] ?? '').toContain('image/png');
      expect(r.headers()['cache-control'] ?? '').toContain('s-maxage=3600');
      const body = await r.body();
      expect(body.subarray(0, 4).equals(PNG_MAGIC), 'PNG magic').toBe(true);
      return body;
    };
    // The site cache may lag the publish by a beat on a cold ISR entry.
    await expect
      .poll(async () => (await anon.request.get(`/org/${heroSite.subdomain}/card.png`)).status(), { timeout: 30_000, intervals: [1000, 2000, 3000] })
      .toBe(200);
    const heroCard = await card(heroSite.subdomain);
    const plainCard = await card(plainSite.subdomain);
    // A by-hand look: E2E_DUMP_DIR=/some/dir writes both PNGs there.
    if (process.env.E2E_DUMP_DIR) {
      fs.writeFileSync(path.join(process.env.E2E_DUMP_DIR, 'card-hero.png'), heroCard);
      fs.writeFileSync(path.join(process.env.E2E_DUMP_DIR, 'card-plain.png'), plainCard);
    }
    expect(heroCard.length, 'the photo card is a different picture').not.toBe(plainCard.length);
    // A photo card is far heavier than a two-colour gradient + text.
    expect(heroCard.length).toBeGreaterThan(plainCard.length);
  } finally {
    await anon.close();
    await ownerApi.dispose();
    await admin.from('clubs').delete().in('id', [heroClub, plainClub]);
    if (assetPath) await admin.storage.from('uploads').remove([assetPath]);
  }
});
