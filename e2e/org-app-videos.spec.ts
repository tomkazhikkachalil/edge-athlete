import { test, expect } from './helpers/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { openWindow } from './helpers/org-page';

// Videos program (296): the org's Videos bubble reads /api/videos?side=&orgId=
// under the org gallery's gate. The owner links a full game to the club; a
// member sees the face count it and the window list it; a stranger of a
// PUBLIC club reads the list; once the club is private, the stranger is
// refused (members only) and the member still reads. A member never
// manages (403 on a write); the owner's hidden video stays the managers'.
const YT = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

test('org videos: owner links → member sees the bubble + window; public → anyone; private → members only; a member cannot manage', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const alpha = loadQaUser('user.json'); // the member (the default page context)
  await resetRateBucket(admin, 'video-write', owner.id);
  await resetRateBucket(admin, 'video-write', alpha.id);
  const stamp = `${Date.now()}`;
  const club = await createQaOrg(admin, 'club', { name: `QA Video Club ${stamp}`, owner_profile_id: owner.id, sport_key: 'golf', visibility: 'public' });
  const clubId = club.id;
  await admin.from('memberships').insert([
    { org_id: clubId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { org_id: clubId, profile_id: alpha.id, role: 'member', kind: 'follow' },
  ]);
  const ownerApi = await apiAs('state-b.json');
  const alphaApi = await apiAs('state.json');
  const anon = await browser.newContext({ storageState: 'e2e/.auth/anon.json' });
  let videoId: string | null = null;
  try {
    // The owner links it to the club.
    let res = await ownerApi.post('/api/videos', { data: { url: YT, title: `QA Club final ${stamp}`, side: 'club', org_id: clubId } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const video = (await res.json()).video as { id: string; owner: { kind: string; id: string } };
    videoId = video.id;
    expect(video.owner).toMatchObject({ kind: 'org', id: clubId });

    // A member cannot: 403 on the org, 403 on the video's own writes.
    res = await alphaApi.post('/api/videos', { data: { url: YT, side: 'club', org_id: clubId } });
    expect(res.status()).toBe(403);
    res = await alphaApi.post(`/api/videos/${videoId}/highlights`, { data: { start_ms: 1000, label: 'nope' } });
    expect(res.status()).toBe(403);

    // A stranger reads a public club's list.
    res = await anon.request.get(`/api/videos?side=club&orgId=${clubId}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(((await res.json()).videos as Array<{ id: string }>).map(v => v.id)).toContain(videoId);

    // The member's page: the bubble counts it; the window lists the card.
    await page.goto(`/club/${clubId}`);
    const face = page.locator('[data-org-bubble="videos"]');
    await expect(face).toBeVisible({ timeout: 20_000 });
    await expect(face).toContainText('1');
    const win = await openWindow(page, 'videos');
    await expect(win.locator('[data-org-videos="1"]')).toBeVisible();
    await expect(win.locator(`[data-video-card="${videoId}"]`)).toBeVisible();
    // A member sees no door.
    await expect(win.locator('[data-video-add]')).toHaveCount(0);

    // Private: the stranger is refused, the member still reads, the owner's hidden video is the managers' only.
    const { error } = await admin.from('organizations').update({ visibility: 'private' }).eq('id', clubId);
    expect(error).toBeNull();
    res = await anon.request.get(`/api/videos?side=club&orgId=${clubId}`);
    expect(res.status()).toBe(403);
    res = await alphaApi.get(`/api/videos?side=club&orgId=${clubId}`);
    expect(res.status()).toBe(200);
    res = await ownerApi.patch(`/api/videos/${videoId}`, { data: { status: 'hidden' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await alphaApi.get(`/api/videos?side=club&orgId=${clubId}`);
    expect(((await res.json()).videos as Array<{ id: string }>).map(v => v.id)).not.toContain(videoId);
    res = await alphaApi.get(`/api/videos/${videoId}`);
    expect(res.status()).toBe(404);
    res = await ownerApi.get(`/api/videos/${videoId}`);
    expect(res.status()).toBe(200);
    expect(((await res.json()).video as { status: string }).status).toBe('hidden');
  } finally {
    if (videoId) await ownerApi.delete(`/api/videos/${videoId}`).catch(() => undefined);
    await anon.close();
    await ownerApi.dispose();
    await alphaApi.dispose();
    await deleteQaOrgs(admin, [clubId]);
  }
});
