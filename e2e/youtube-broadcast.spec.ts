import { test, expect, request as pwRequest, type APIRequestContext } from './helpers/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, loadQaUser, mintStorageState, readErrorBody, resetRateBucket, type QaUser } from './helpers/qa-user';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { startYouTubeMock, type MockChannel, type YouTubeMock } from './helpers/youtube-mock';

// Videos program Phase 4b (Nov 5 2026): the broadcast created from Edge
// Athlete. The connector schedules it from the Add a full game flow: the
// third consent (the force-ssl scope) is asked at the moment of need, the
// server makes the broadcast + one stream + the bind on the stand-in, the
// key is shown ONCE on the page and appears in no other answer, Continue
// makes the row and Phase 4a's first read says upcoming with the time. The
// channel's eligibility comes back in our words; a manager who did not
// connect is refused; the key never reaches a row.

const CHANNEL: MockChannel = { id: 'UCe2eBroadcastChannel01', title: 'QA Club Channel', uploads: [] };

async function ctxFor(u: QaUser): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(u), extraHTTPHeaders: bypassHeaders() });
}

let mock: YouTubeMock;
test.beforeAll(async () => { mock = await startYouTubeMock(); });
test.afterAll(async () => { await mock.close(); });

test('the connector schedules a broadcast from the flow: the third consent, the key once, the row upcoming; eligibility in words; a manager cannot', async ({ browser }) => {
  test.setTimeout(180_000);
  const a = loadQaUser('user.json');
  const b = loadQaUser('user-b.json');
  const admin = adminClient();
  for (const bucket of ['connection-write', 'video-write'] as const) { await resetRateBucket(admin, bucket, a.id); await resetRateBucket(admin, bucket, b.id); }
  const stamp = Date.now();
  const club = await createQaOrg(admin, 'club', { name: `QA Broadcast Club ${stamp}`, sport_key: 'golf', owner_profile_id: a.id, visibility: 'public' });
  await admin.from('memberships').insert([
    { org_id: club.id, profile_id: a.id, kind: 'follow', role: 'owner', status: 'active' },
    { org_id: club.id, profile_id: b.id, kind: 'follow', role: 'manager', status: 'active' },
  ]);
  const owner = `club:${club.id}`;
  const page = await (await browser.newContext({ storageState: await mintStorageState(a), extraHTTPHeaders: bypassHeaders() })).newPage();
  const apiA = await ctxFor(a);
  const apiB = await ctxFor(b);
  const startsAt = new Date(Date.now() + 2 * 3_600_000).toISOString();
  const schedule = { owner, title: 'Club final — live', scheduledStartAt: startsAt, privacy: 'unlisted' };
  let videoRowId: string | null = null;
  try {
    // 1. Connect (readonly). Scheduling needs the live scope: 409 names it; the second consent adds it.
    mock.signInAs(CHANNEL);
    await page.goto(`/api/videos/youtube/start?owner=${owner}&scope=readonly`);
    await expect.poll(() => page.url(), { timeout: 20_000 }).toContain('youtube=connected');
    let res = await apiA.post('/api/videos/youtube/broadcast', { data: schedule });
    expect(res.status(), await readErrorBody(res)).toBe(409);
    expect((await res.json()).needs_scope).toBe('live');
    await page.goto(`/api/videos/youtube/start?owner=${owner}&scope=live`);
    await expect.poll(() => page.url(), { timeout: 20_000 }).toContain('youtube=connected&scope=live');
    const view = (await (await apiA.get(`/api/videos/youtube/connection?owner=${owner}`)).json()).connection as { scopes: string[]; canBroadcast: boolean; canUpload: boolean };
    expect(view.scopes).toEqual(['readonly', 'live']);
    expect(view.canBroadcast).toBe(true);

    // 2. A bad body and the channel's eligibility, in words.
    res = await apiA.post('/api/videos/youtube/broadcast', { data: { ...schedule, scheduledStartAt: new Date(Date.now() - 60_000).toISOString() } });
    expect(res.status()).toBe(400);
    mock.liveEligibility = 'not_enabled';
    res = await apiA.post('/api/videos/youtube/broadcast', { data: schedule });
    expect(res.status()).toBe(403);
    expect((await res.json()).reason).toBe('not_enabled');
    mock.liveEligibility = 'blocked';
    res = await apiA.post('/api/videos/youtube/broadcast', { data: schedule });
    expect(res.status()).toBe(403);
    expect((await res.json()).reason).toBe('blocked');
    mock.liveEligibility = 'ok';
    expect(mock.broadcasts.size).toBe(0); // nothing created on a refusal

    // 3. The manager who did not connect may link but cannot schedule: it is A's grant.
    res = await apiB.post('/api/videos/youtube/broadcast', { data: schedule });
    expect(res.status()).toBe(403);

    // 4. From the PAGE: the door → the panel → the key sheet (once) → Continue → Details → Save.
    await page.goto(`/videos/new?side=club&orgId=${club.id}`);
    await expect(page.locator('[data-new-video-broadcast-door]')).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-new-video-broadcast-door]').click();
    await page.locator('[data-youtube-broadcast-title]').fill('Club final — live');
    await page.locator('[data-youtube-broadcast-schedule]').click();
    await expect(page.locator('[data-youtube-broadcast="scheduled"]')).toBeVisible({ timeout: 20_000 });
    const key = await page.locator('[data-youtube-broadcast-key]').inputValue();
    expect(key).toMatch(/^e2e-stream-key-/);
    await page.locator('[data-youtube-broadcast-encoder]').click();
    await expect(page.locator('[data-youtube-broadcast-url]')).toHaveValue('rtmps://a.rtmps.youtube.com/live2');
    const broadcastId = await page.locator('[data-youtube-broadcast="scheduled"]').getAttribute('data-youtube-broadcast-id');
    expect(broadcastId).toMatch(/^e2eLive/);
    expect(await page.locator('[data-youtube-broadcast-studio]').getAttribute('href')).toBe(`https://studio.youtube.com/video/${broadcastId}/livestreaming`);
    const made = mock.broadcasts.get(broadcastId!)!;
    expect(made).toMatchObject({ title: 'Club final — live', privacy: 'unlisted' });
    expect(made.streamId).not.toBeNull(); // bound
    expect(mock.streams.get(made.streamId!)!.key).toBe(key);
    expect(mock.calls.filter(c => c === 'DELETE /youtube/v3/liveBroadcasts')).toHaveLength(0);

    await page.locator('[data-youtube-broadcast-continue]').click();
    await expect(page.locator('[data-new-video-uploaded]')).toContainText('Scheduled on YouTube');
    await page.locator('[data-step-next]').click();
    await page.locator('[data-step-finish]').click();
    await expect.poll(() => page.url(), { timeout: 20_000 }).toMatch(/\/videos\/[0-9a-f-]{36}$/);
    videoRowId = page.url().split('/').pop()!;

    // 5. The row is an ordinary link that the first read made upcoming; the key is in no answer.
    res = await apiA.get(`/api/videos/${videoRowId}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const row = (await res.json()).video as { provider_video_id: string; live_status: string; scheduled_start_at: string | null };
    expect(row.provider_video_id).toBe(broadcastId);
    expect(row.live_status).toBe('upcoming');
    expect(row.scheduled_start_at).not.toBeNull();
    expect(JSON.stringify(await (await apiA.get(`/api/videos/${videoRowId}`)).json())).not.toContain(key);
    expect(JSON.stringify(await (await apiA.get(`/api/videos/youtube/connection?owner=${owner}`)).json())).not.toContain(key);
    await expect(page.locator('[data-video-live="upcoming"]')).toBeVisible();
    const { data: dbRow } = await admin.from('videos').select('*').eq('id', videoRowId).single();
    expect(JSON.stringify(dbRow)).not.toContain(key);

    // 6. Phase 4a untouched: the stand-in goes live, the stale row reads it.
    mock.live.set(broadcastId!, { content: 'live', scheduledStartTime: startsAt, actualStartTime: new Date(Date.now() - 30_000).toISOString() });
    await admin.from('videos').update({ live_checked_at: new Date(Date.now() - 10 * 60_000).toISOString() }).eq('id', videoRowId);
    res = await apiA.get(`/api/videos/${videoRowId}`);
    expect((await res.json()).video.live_status).toBe('live');
  } finally {
    if (videoRowId) await apiA.delete(`/api/videos/${videoRowId}`).catch(() => undefined);
    await admin.from('youtube_connections').delete().eq('org_id', club.id);
    await deleteQaOrgs(admin, [club.id]);
    mock.live.clear();
    mock.broadcasts.clear();
    mock.liveEligibility = 'ok';
    await apiA.dispose();
    await apiB.dispose();
    await page.context().close();
  }
});
