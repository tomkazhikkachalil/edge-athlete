import { test, expect, request as pwRequest, type APIRequestContext } from './helpers/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, loadQaUser, mintStorageState, readErrorBody, resetRateBucket, type QaUser } from './helpers/qa-user';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { startYouTubeMock, YOUTUBE_MOCK_BASE, type MockChannel, type YouTubeMock } from './helpers/youtube-mock';

// Videos program Phase 3 (Nov 5 2026): the YouTube connection. The owner
// connects a channel once (Google's consent, PKCE, the signed state), links
// one of the channel's uploads in a tap, allows uploads (the second, incremental
// consent), uploads a file straight to "YouTube" (the resumable PUTs from the
// device — here from node, the same protocol youtube-upload.ts speaks), the
// row appears like any link, the details refresh fills the duration, and the
// disconnect ends it. Everything runs against a STAND-IN Google
// (helpers/youtube-mock.ts); a real channel is the one thing only Tom can prove.

const CHANNEL: MockChannel = {
  id: 'UCe2eChannelAbcdefghijkl',
  title: 'QA Golf Channel',
  uploads: [
    { videoId: 'e2eUpload01', title: 'Club Championship Final', publishedAt: '2026-10-01T12:00:00Z', durationIso: 'PT2H15M3S' },
    { videoId: 'e2eUpload02', title: 'Junior Open round 1', publishedAt: '2026-09-20T12:00:00Z', durationIso: 'PT1H1M' },
  ],
};

async function ctxFor(u: QaUser): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(u), extraHTTPHeaders: bypassHeaders() });
}

let mock: YouTubeMock;
test.beforeAll(async () => { mock = await startYouTubeMock(); });
test.afterAll(async () => { await mock.close(); });

test('a profile connects its channel, links an upload in one tap, allows uploads, uploads a file, refreshes the duration, disconnects', async ({ browser }) => {
  test.setTimeout(180_000);
  const a = loadQaUser('user.json');
  const b = loadQaUser('user-b.json');
  const admin = adminClient();
  for (const bucket of ['connection-write', 'video-write'] as const) await resetRateBucket(admin, bucket, a.id);
  const owner = `profile:${a.id}`;
  const page = await (await browser.newContext({ storageState: await mintStorageState(a), extraHTTPHeaders: bypassHeaders() })).newPage();
  const api = await ctxFor(a);
  const other = await ctxFor(b);
  const videoIds: string[] = [];
  try {
    await admin.from('youtube_connections').delete().eq('profile_id', a.id);

    // 1. Connect (readonly): the start route → the stand-in consent → the callback → back on the Videos tab.
    mock.signInAs(CHANNEL);
    await page.goto(`/api/videos/youtube/start?owner=${owner}&scope=readonly`);
    await expect.poll(() => page.url(), { timeout: 20_000 }).toContain('youtube=connected');
    expect(page.url()).toContain('tab=videos');
    expect(mock.calls).toContain('GET /o/oauth2/v2/auth');
    expect(mock.calls).toContain('POST /token');

    let res = await api.get(`/api/videos/youtube/connection?owner=${owner}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    let view = (await res.json()).connection;
    expect(view).toMatchObject({ connected: true, channelId: CHANNEL.id, channelTitle: CHANNEL.title, scopes: ['readonly'], status: 'active', connectedByMe: true, canManage: true, canUpload: true, problem: null });
    expect(JSON.stringify(view)).not.toMatch(/refresh|cipher|yt-access/);
    // A stranger sees nothing of it.
    expect((await other.get(`/api/videos/youtube/connection?owner=${owner}`)).status()).toBe(404);

    // 2. The channel's uploads, newest first — one tap links the first.
    res = await api.get(`/api/videos/youtube/channel-uploads?owner=${owner}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const uploads = (await res.json()).uploads as Array<{ videoId: string; title: string }>;
    expect(uploads.map(u => u.videoId)).toEqual(['e2eUpload01', 'e2eUpload02']);
    res = await api.post('/api/videos', { data: { url: `https://www.youtube.com/watch?v=${uploads[0].videoId}`, title: uploads[0].title } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const linked = (await res.json()).video as { id: string; duration_ms: number | null };
    videoIds.push(linked.id);
    // Phase 4a: the first read on the link (the connection's token) already fills the duration.
    expect(linked.duration_ms).toBe((2 * 3600 + 15 * 60 + 3) * 1000);

    // 3. The details refresh through the connection answers the same duration.
    res = await api.post(`/api/videos/${linked.id}/refresh`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await res.json()).duration_ms).toBe((2 * 3600 + 15 * 60 + 3) * 1000);

    // 4. An upload needs the upload scope first: 409 names it; the second consent adds it.
    const sessionBody = { owner, title: 'QA Final', description: 'from e2e', privacy: 'unlisted', sizeBytes: 8 * 1024 * 1024 + 1234, contentType: 'video/mp4' };
    res = await api.post('/api/videos/youtube/upload-session', { data: sessionBody });
    expect(res.status()).toBe(409);
    expect((await res.json()).needs_scope).toBe('upload');
    await page.goto(`/api/videos/youtube/start?owner=${owner}&scope=upload`);
    await expect.poll(() => page.url(), { timeout: 20_000 }).toContain('youtube=connected&scope=upload');
    view = (await (await api.get(`/api/videos/youtube/connection?owner=${owner}`)).json()).connection;
    expect(view.scopes).toEqual(['readonly', 'upload']);

    // 5. The session, then the device's resumable PUTs (two chunks; a 308 between) — the id comes back.
    res = await api.post('/api/videos/youtube/upload-session', { data: sessionBody });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const session = (await res.json()) as { session_uri: string; access_token: string; chunk_bytes: number };
    expect(session.session_uri.startsWith(YOUTUBE_MOCK_BASE)).toBe(true);
    expect(session.chunk_bytes).toBe(8 * 1024 * 1024);
    const size = sessionBody.sizeBytes;
    const bytes = new Uint8Array(size);
    const put = (start: number, end: number) => fetch(session.session_uri, { method: 'PUT', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Range': `bytes ${start}-${end - 1}/${size}` }, body: bytes.slice(start, end) });
    const first = await put(0, session.chunk_bytes);
    expect(first.status).toBe(308);
    expect(first.headers.get('range')).toBe(`bytes=0-${session.chunk_bytes - 1}`);
    const last = await put(session.chunk_bytes, size);
    expect(last.status).toBe(200);
    const { id: uploadedId } = (await last.json()) as { id: string };
    expect(uploadedId).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(mock.uploaded.get(uploadedId)).toMatchObject({ size, title: 'QA Final', privacy: 'unlisted', contentType: 'video/mp4' });

    // 6. The uploaded id becomes a row like any link.
    res = await api.post('/api/videos', { data: { url: `https://youtu.be/${uploadedId}`, title: 'QA Final' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    videoIds.push((await res.json()).video.id);

    // 7. Disconnect: the row goes, the videos stay.
    res = await api.delete(`/api/videos/youtube/connection?owner=${owner}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await res.json()).removed).toBe(true);
    expect(mock.calls).toContain('POST /revoke');
    view = (await (await api.get(`/api/videos/youtube/connection?owner=${owner}`)).json()).connection;
    expect(view).toMatchObject({ connected: false, channelId: null, canUpload: false });
    expect((await api.get(`/api/videos/${videoIds[0]}`)).status()).toBe(200);
    expect((await api.post('/api/videos/youtube/upload-session', { data: sessionBody })).status()).toBe(404);
  } finally {
    for (const id of videoIds) await api.delete(`/api/videos/${id}`).catch(() => undefined);
    await admin.from('youtube_connections').delete().eq('profile_id', a.id);
    await api.dispose();
    await other.dispose();
    await page.context().close();
  }
});

test('an org: the owner connects; a manager without the grant may link but not upload; a denied consent and no channel say why', async ({ browser }) => {
  test.setTimeout(180_000);
  const a = loadQaUser('user.json');
  const b = loadQaUser('user-b.json');
  const admin = adminClient();
  for (const bucket of ['connection-write', 'video-write'] as const) { await resetRateBucket(admin, bucket, a.id); await resetRateBucket(admin, bucket, b.id); }
  const stamp = Date.now();
  const club = await createQaOrg(admin, 'club', { name: `QA YouTube Club ${stamp}`, sport_key: 'golf', owner_profile_id: a.id, visibility: 'public' });
  await admin.from('memberships').insert([
    { org_id: club.id, profile_id: a.id, kind: 'follow', role: 'owner', status: 'active' },
    { org_id: club.id, profile_id: b.id, kind: 'follow', role: 'manager', status: 'active' },
  ]);
  const owner = `club:${club.id}`;
  const pageA = await (await browser.newContext({ storageState: await mintStorageState(a), extraHTTPHeaders: bypassHeaders() })).newPage();
  const apiA = await ctxFor(a);
  const apiB = await ctxFor(b);
  try {
    // A denied consent comes back with the word.
    mock.signInAs(CHANNEL);
    mock.deny(true);
    await pageA.goto(`/api/videos/youtube/start?owner=${owner}&scope=upload`);
    await expect.poll(() => pageA.url(), { timeout: 20_000 }).toContain('youtube_error=denied');
    mock.deny(false);
    // A Google account with no channel.
    mock.signInAs(null);
    await pageA.goto(`/api/videos/youtube/start?owner=${owner}&scope=upload`);
    await expect.poll(() => pageA.url(), { timeout: 20_000 }).toContain('youtube_error=nochannel');
    // The owner connects with upload allowed at once.
    mock.signInAs(CHANNEL);
    await pageA.goto(`/api/videos/youtube/start?owner=${owner}&scope=upload`);
    await expect.poll(() => pageA.url(), { timeout: 20_000 }).toContain('youtube=connected');
    expect(pageA.url()).toContain(`/app/org/club/${club.id}`);

    // The manager sees the connection, may read the channel and link, but cannot upload: it is A's grant.
    let res = await apiB.get(`/api/videos/youtube/connection?owner=${owner}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await res.json()).connection).toMatchObject({ connected: true, canManage: true, connectedByMe: false, canUpload: false });
    res = await apiB.get(`/api/videos/youtube/channel-uploads?owner=${owner}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await apiB.post('/api/videos/youtube/upload-session', { data: { owner, title: 'x', description: '', privacy: 'private', sizeBytes: 10, contentType: 'video/mp4' } });
    expect(res.status()).toBe(403);
    res = await apiA.post('/api/videos/youtube/upload-session', { data: { owner, title: 'x', description: '', privacy: 'private', sizeBytes: 10, contentType: 'video/mp4' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    // A non-manager cannot start the flow for the org.
    const c = await ctxFor(loadQaUser('user-c.json'));
    const start = await c.get(`/api/videos/youtube/start?owner=${owner}&scope=readonly`, { maxRedirects: 0 });
    expect(start.status()).toBe(302);
    expect(start.headers()['location']).toContain('youtube_error=forbidden');
    await c.dispose();
  } finally {
    await admin.from('youtube_connections').delete().eq('org_id', club.id);
    await deleteQaOrgs(admin, [club.id]);
    await apiA.dispose();
    await apiB.dispose();
    await pageA.context().close();
  }
});
