import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { cleanRoundPost, seedRoundPost } from './helpers/member-photos';
import path from 'node:path';
import { openWindow } from './helpers/org-page';

// Org Pages R4: the in-app Photos bubble reads /api/{side}s/[id]/gallery —
// the public site's list under the public site's gates. A member's public
// round photo, consented on the follow row and picked by a manager onto a
// PUBLISHED, PUBLIC club site, counts on the face and opens in the lightbox;
// revoking consent removes it from the list AND 404s the streamer (one
// gate, re-run per read); a private org answers members only.

test('org gallery: picked member photo → face, window, lightbox; revoke → gone + 404; private org → members only', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const alpha = loadQaUser('user.json'); // the member (the default page context)
  await resetRateBucket(admin, 'org-site', owner.id);
  const stamp = `${Date.now()}`;

  // QA users are minted PRIVATE — the gate needs a public author. Restored in finally.
  const { data: alphaProfile } = await admin.from('profiles').select('visibility').eq('id', alpha.id).single();
  const priorVisibility = alphaProfile!.visibility as string;
  await admin.from('profiles').update({ visibility: 'public' }).eq('id', alpha.id);

  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA Gallery Club ${stamp}`, owner_profile_id: owner.id, primary_sport: 'golf' })
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
  let pub: Awaited<ReturnType<typeof seedRoundPost>> | null = null;
  try {
    let res = await ownerApi.post(`/api/clubs/${clubId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const site = (await res.json()).site as { id: string };
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'set_module', moduleKey: 'gallery', enabled: true } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // The member consents on their follow row, posts a public round with a
    // photo, and the manager picks it.
    res = await alphaApi.patch(`/api/clubs/${clubId}/photo-consent`, { data: { consent: true } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    pub = await seedRoundPost(admin, alpha.id, { stamp, visibility: 'public' });
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'set_gallery_pick', mediaId: pub.mediaId } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // The read: anonymous (public org) sees the item, as a member item.
    res = await anon.request.get(`/api/clubs/${clubId}/gallery`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    type GalleryBody = { items: Array<{ id: string; url: string; kind: string }> };
    let body = (await res.json()) as GalleryBody;
    const item = body.items.find(i => i.id === pub!.mediaId);
    expect(item, 'the picked photo is in the in-app gallery').toBeTruthy();
    expect(item!.kind).toBe('member');
    expect(item!.url).toBe(`/api/media/org-gallery/${site.id}/${pub.mediaId}`);
    const streamer = await anon.request.get(item!.url);
    expect(streamer.status()).toBe(200);

    // The page (the member): Photos face counts it; the window's tile opens
    // the lightbox (the same image twice: the tile and the viewer).
    await page.goto(`/club/${clubId}`);
    const face = page.locator('[data-org-bubble="photos"]');
    await expect(face).toBeVisible({ timeout: 20_000 });
    await expect(face).toContainText('1');
    // Optional visual dump (E2E_DUMP_DIR precedent): the face, then the window.
    const dump = process.env.E2E_DUMP_DIR;
    if (dump) {
      await face.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished)));
      await expect.poll(() => face.locator('img').first().evaluate(i => (i as HTMLImageElement).naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0);
      await face.screenshot({ path: path.join(dump, 'org-photos-face.png') });
    }
    const win = await openWindow(page, 'photos');
    await expect(win.locator('[data-org-gallery="1"]')).toBeVisible();
    if (dump) await page.screenshot({ path: path.join(dump, 'org-photos-window.png') });
    const tile = win.locator('[data-media-tile]').first();
    await expect(tile).toBeVisible();
    // The tile opens the house lightbox (a labelled dialog above the window)
    // showing the same streamer URL; Escape closes it back to the window.
    await tile.click();
    const viewer = page.getByRole('dialog', { name: 'Media viewer' });
    await expect(viewer).toBeVisible({ timeout: 10_000 });
    await expect(viewer.locator(`img[src="${item!.url}"]`)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await expect(win).toBeVisible();
    await page.keyboard.press('Escape');

    // Revoke consent → the list omits it AND the bytes 404 (one gate).
    res = await alphaApi.patch(`/api/clubs/${clubId}/photo-consent`, { data: { consent: false } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await anon.request.get(`/api/clubs/${clubId}/gallery`);
    body = (await res.json()) as GalleryBody;
    expect(body.items.some(i => i.id === pub!.mediaId)).toBe(false);
    expect((await anon.request.get(item!.url)).status()).toBe(404);

    // A private org: anonymous 403, member 200.
    await admin.from('clubs').update({ visibility: 'private' }).eq('id', clubId);
    expect((await anon.request.get(`/api/clubs/${clubId}/gallery`)).status()).toBe(403);
    expect((await alphaApi.get(`/api/clubs/${clubId}/gallery`)).status()).toBe(200);
  } finally {
    await anon.close();
    await ownerApi.dispose();
    await alphaApi.dispose();
    await cleanRoundPost(admin, pub);
    await admin.from('clubs').delete().eq('id', clubId);
    await admin.from('profiles').update({ visibility: priorVisibility }).eq('id', alpha.id);
  }
});
