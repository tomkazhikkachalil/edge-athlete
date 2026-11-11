import { test, expect, request as pwRequest, type APIRequestContext } from './helpers/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, loadQaUser, mintStorageState, readErrorBody, resetRateBucket, type QaUser } from './helpers/qa-user';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { landingOf, startYouTubeMock, YOUTUBE_MOCK_BASE, type MockChannel, type YouTubeMock } from './helpers/youtube-mock';

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
    expect(await landingOf(page, `/api/videos/youtube/start?owner=${owner}&scope=readonly`)).toContain('youtube=connected');
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
    expect(await landingOf(page, `/api/videos/youtube/start?owner=${owner}&scope=upload`)).toContain('youtube=connected&scope=upload');
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
    expect(await landingOf(pageA, `/api/videos/youtube/start?owner=${owner}&scope=upload`)).toContain('youtube_error=denied');
    mock.deny(false);
    // A Google account with no channel.
    mock.signInAs(null);
    expect(await landingOf(pageA, `/api/videos/youtube/start?owner=${owner}&scope=upload`)).toContain('youtube_error=nochannel');
    // The owner connects with upload allowed at once.
    mock.signInAs(CHANNEL);
    expect(await landingOf(pageA, `/api/videos/youtube/start?owner=${owner}&scope=upload`)).toContain('youtube=connected');
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

// Self-healing (Nov 10 2026): a 401 is a stale token first — one forced
// refresh, one more try. Only Google's invalid_grant, or a 401 on a token
// minted a moment ago, ends a connection; and then every screen says
// "Reconnect" instead of "no channel" or nothing at all.
test('self-healing: a stale token is refreshed and retried, an old error row heals, the quota has its own words, a dead grant says Reconnect everywhere and one tap restores it', async ({ browser }) => {
  test.setTimeout(180_000);
  const a = loadQaUser('user.json');
  const admin = adminClient();
  for (const bucket of ['connection-write', 'video-write', 'video-lookup'] as const) await resetRateBucket(admin, bucket, a.id);
  const owner = `profile:${a.id}`;
  const page = await (await browser.newContext({ storageState: await mintStorageState(a), extraHTTPHeaders: bypassHeaders() })).newPage();
  const api = await ctxFor(a);
  const viewOf = async (check = false) => (await (await api.get(`/api/videos/youtube/connection?owner=${owner}${check ? '&check=1' : ''}`)).json()).connection;
  try {
    await admin.from('youtube_connections').delete().eq('profile_id', a.id);
    mock.signInAs(CHANNEL);
    expect(await landingOf(page, `/api/videos/youtube/start?owner=${owner}&scope=readonly`)).toContain('youtube=connected');

    // 1. Every token so far dies at YouTube (a 401): the read still answers — one refresh, one retry — and the row stays active.
    let before = mock.tokensMinted();
    mock.expireAccess();
    let res = await api.get(`/api/videos/youtube/channel-uploads?owner=${owner}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(((await res.json()).uploads as unknown[]).length).toBe(2);
    expect(mock.tokensMinted()).toBe(before + 1);
    expect(await viewOf()).toMatchObject({ status: 'active', problem: null, canUpload: true });

    // 2. A row an older build left in `error` is not dead: its doors stand, and the next good call makes it active again.
    await admin.from('youtube_connections').update({ status: 'error', last_error: 'YouTube refused the channel read — reconnect' }).eq('profile_id', a.id);
    expect(await viewOf()).toMatchObject({ status: 'error', canUpload: true });
    res = await api.get(`/api/videos/youtube/channel-uploads?owner=${owner}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(await viewOf()).toMatchObject({ status: 'active', problem: null });

    // 3. YouTube's daily limit is its own sentence, never "reconnect", and it ends nothing.
    mock.quota(true);
    res = await api.get(`/api/videos/youtube/channel-uploads?owner=${owner}`);
    expect(res.status()).toBe(429);
    let body = (await res.json()) as { error: string; reconnect?: boolean };
    expect(body.error).toMatch(/daily limit/);
    expect(body.reconnect).toBeUndefined();
    mock.quota(false);
    expect(await viewOf()).toMatchObject({ status: 'active' });

    // 4. The health check: a plain read costs YouTube nothing; `check=1` asks once and a standing connection stays as it is.
    before = mock.calls.filter(c => c === 'GET /youtube/v3/channels').length;
    await viewOf();
    expect(mock.calls.filter(c => c === 'GET /youtube/v3/channels').length).toBe(before);
    expect(await viewOf(true)).toMatchObject({ status: 'active', channelTitle: CHANNEL.title });
    expect(mock.calls.filter(c => c === 'GET /youtube/v3/channels').length).toBe(before + 1);

    // 5. The grant is gone (a fresh token is refused too): the check finds it NOW — revoked, with the words — and every call says reconnect.
    mock.refuseAll(true);
    expect(await viewOf(true)).toMatchObject({ connected: true, status: 'revoked', canUpload: false, problem: expect.stringContaining('reconnect') });
    mock.refuseAll(false);
    res = await api.get(`/api/videos/youtube/channel-uploads?owner=${owner}`);
    expect(res.status()).toBe(409);
    body = (await res.json()) as { error: string; reconnect?: boolean };
    expect(body.reconnect).toBe(true);
    expect(body.error).not.toMatch(/No YouTube channel/);

    // 6. The Full game flow names the problem with its door; one tap at Google and the connection stands again.
    await page.goto('/videos/new');
    const problem = page.locator('[data-new-video-youtube-problem="revoked"]');
    await expect(problem).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-channel-picker]')).toHaveCount(0);
    // Phone width: the sentence and its door wrap inside 375 px.
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(problem).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await problem.locator('[data-youtube-reconnect-link]').click();
    // The flow round: the reconnect lands back in the flow, which says so.
    await expect(page.locator('[data-new-video-youtube-result="connected"]')).toBeVisible({ timeout: 20_000 });
    expect(await viewOf()).toMatchObject({ status: 'active', problem: null, canUpload: true });

    // 7. Google's own word (invalid_grant on the refresh) ends it too — and the answer is "reconnect", not "no channel".
    mock.expireAccess();
    mock.revokeRefresh(true);
    res = await api.get(`/api/videos/youtube/channel-uploads?owner=${owner}`);
    expect(res.status()).toBe(409);
    expect((await res.json()).reconnect).toBe(true);
    expect(await viewOf()).toMatchObject({ status: 'revoked' });
  } finally {
    mock.revokeRefresh(false);
    mock.refuseAll(false);
    mock.quota(false);
    await admin.from('youtube_connections').delete().eq('profile_id', a.id);
    await api.dispose();
    await page.context().close();
  }
});

// The flow round (Nov 10 2026): the Connect door is in the Full game flow,
// every trip to Google comes back to it with what was typed, an unticked box
// at Google is said in words, and the card shows what is allowed, survives a
// failed read, and cleans the address.
test('the flow round: connect from inside Full game and come back with the form kept; an unticked box says so; the card shows what is allowed and never vanishes; a return path is ours only', async ({ browser }) => {
  test.setTimeout(240_000);
  const a = loadQaUser('user.json');
  const admin = adminClient();
  for (const bucket of ['connection-write', 'video-write', 'video-lookup'] as const) await resetRateBucket(admin, bucket, a.id);
  const owner = `profile:${a.id}`;
  const ctx = await browser.newContext({ storageState: await mintStorageState(a), extraHTTPHeaders: bypassHeaders(), viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  const api = await ctxFor(a);
  const viewOf = async () => (await (await api.get(`/api/videos/youtube/connection?owner=${owner}`)).json()).connection;
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const LINK = 'https://www.youtube.com/watch?v=e2eUpload02';
  const urlField = page.locator('[data-new-video] input[type="url"]');
  const askUploadScope = async () => {
    await page.locator('[data-new-video-upload-door]').click();
    await page.locator('[data-youtube-upload-file]').setInputFiles({ name: 'game.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(2048, 1) });
    await page.locator('[data-youtube-upload-title]').fill('QA flow upload');
    await page.locator('[data-youtube-upload-start]').click();
    await expect(page.locator('[data-new-video-needs-scope="upload"]')).toBeVisible({ timeout: 20_000 });
  };
  try {
    await admin.from('youtube_connections').delete().eq('profile_id', a.id);
    mock.signInAs(CHANNEL);
    mock.grantedScopes = null;

    // 1. No channel: the flow's Link step carries the Connect door (and the sentence about Google's unverified page), inside 375 px.
    await page.goto('/videos/new');
    const connect = page.locator('[data-new-video-connect]');
    await expect(connect).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-new-video-youtube="connect"]')).toContainText('Advanced');
    expect(await fits()).toBe(true);
    await urlField.fill(LINK);

    // 2. Connect → Google → back in the flow: the link typed is still there, the result is said once, the address is clean, the channel's doors are open.
    await connect.click();
    await expect(page.locator('[data-new-video-youtube-result="connected"]')).toBeVisible({ timeout: 20_000 });
    await expect(urlField).toHaveValue(LINK);
    await expect.poll(() => page.url(), { timeout: 10_000 }).not.toContain('youtube=');
    expect(new URL(page.url()).pathname).toBe('/videos/new');
    await expect(page.locator('[data-channel-picker]')).toBeVisible();
    expect(await viewOf()).toMatchObject({ connected: true, scopes: ['readonly'], unverified: true });

    // 3. "Allow uploads" with the box left unticked at Google: the channel stays connected, the flow says what happened, the link is still there.
    await askUploadScope();
    mock.grantedScopes = ['https://www.googleapis.com/auth/youtube.readonly'];
    await page.locator('[data-new-video-allow="upload"]').click();
    const refused = page.locator('[data-new-video-youtube-result="error"]');
    await expect(refused).toBeVisible({ timeout: 20_000 });
    await expect(refused).toContainText('unticked');
    await expect(urlField).toHaveValue(LINK);
    expect(await fits()).toBe(true);
    expect((await viewOf()).scopes).toEqual(['readonly']);

    // 4. Ticked this time: back in the flow with the upload door already open.
    mock.grantedScopes = null;
    await askUploadScope();
    await page.locator('[data-new-video-allow="upload"]').click();
    await expect(page.locator('[data-new-video-youtube-result="connected"]')).toContainText('Uploads are allowed now', { timeout: 20_000 });
    await expect(page.locator('[data-youtube-upload]')).toBeVisible();
    await expect(urlField).toHaveValue(LINK);
    expect((await viewOf()).scopes).toEqual(['readonly', 'upload']);

    // 5. The card: what is allowed, the door for what is missing; a failed read says so and Retry brings it back.
    await page.goto('/athlete?tab=videos');
    const card = page.locator('[data-youtube-card="connected"]');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.locator('[data-youtube-chip="link"]')).toHaveAttribute('data-on', 'true');
    await expect(card.locator('[data-youtube-chip="upload"]')).toHaveAttribute('data-on', 'true');
    await expect(card.locator('[data-youtube-chip="live"]')).toHaveAttribute('data-on', 'false');
    await expect(card.locator('[data-youtube-allow-live]')).toBeVisible();
    await expect(card.locator('[data-youtube-allow-upload]')).toHaveCount(0);
    expect(await fits()).toBe(true);
    await page.route('**/api/videos/youtube/connection**', route => route.abort());
    await page.reload();
    const failed = page.locator('[data-youtube-card="failed"]');
    await expect(failed).toBeVisible({ timeout: 20_000 });
    await page.unroute('**/api/videos/youtube/connection**');
    await failed.locator('[data-youtube-retry]').click();
    await expect(card).toBeVisible({ timeout: 20_000 });

    // 6. The card's own connect result is read once and leaves the address (the tab stays).
    await page.goto(`/api/videos/youtube/start?owner=${owner}&scope=upload`);
    await expect(page.locator('[data-youtube-result="connected"]')).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => page.url(), { timeout: 10_000 }).not.toContain('youtube=');
    expect(page.url()).toContain('tab=videos');

    // 7. A return path is a path of ours on the short list — anything else falls back to the Videos surface.
    const c = await ctxFor(loadQaUser('user-c.json'));
    const where = async (ret: string) => {
      const res = await c.get(`/api/videos/youtube/start?owner=${owner}&scope=readonly&return=${encodeURIComponent(ret)}`, { maxRedirects: 0 });
      expect(res.status()).toBe(302);
      return new URL(res.headers()['location'], E2E_BASE_URL);
    };
    let to = await where('/videos/new?profileId=abc');
    expect(`${to.pathname}${to.search}`).toBe('/videos/new?profileId=abc&youtube_error=forbidden');
    for (const bad of ['https://evil.example/videos/new', '//evil.example/videos/new', '/api/account', '/feed']) {
      to = await where(bad);
      expect(to.origin, bad).toBe(new URL(E2E_BASE_URL).origin);
      expect(to.pathname, bad).toBe('/athlete');
      expect(to.search, bad).toContain('youtube_error=forbidden');
    }
    await c.dispose();
  } finally {
    mock.grantedScopes = null;
    await admin.from('youtube_connections').delete().eq('profile_id', a.id);
    await api.dispose();
    await ctx.close();
  }
});

// Correct state (Nov 10 2026): the row says what Google granted — a reconnect
// through another account never inherits the old permissions and names the
// channel it replaced; a permission the token lacks leaves the row; force-ssl
// covers uploads; a disconnect never ends the same person's other connection;
// and the Full game flow shows the channel of the owner actually picked.
test('correct state: a reconnect replaces the permissions and names the swapped channel; a stale claim corrects itself; live covers uploads; disconnect spares a sibling; the flow follows the picked owner', async ({ browser }) => {
  test.setTimeout(240_000);
  const a = loadQaUser('user.json');
  const admin = adminClient();
  for (const bucket of ['connection-write', 'video-write', 'video-lookup'] as const) await resetRateBucket(admin, bucket, a.id);
  const SECOND: MockChannel = { id: 'UCe2eSecondAbcdefghijklm', title: 'QA Second Channel', uploads: [{ videoId: 'e2eSecond01', title: 'Second channel game', publishedAt: '2026-10-05T12:00:00Z', durationIso: 'PT45M' }] };
  const stamp = Date.now();
  const clubName = `QA State Club ${stamp}`;
  const club = await createQaOrg(admin, 'club', { name: clubName, sport_key: 'golf', owner_profile_id: a.id, visibility: 'public' });
  await admin.from('memberships').insert([{ org_id: club.id, profile_id: a.id, kind: 'follow', role: 'owner', status: 'active' }]);
  const mine = `profile:${a.id}`;
  const clubRef = `club:${club.id}`;
  const page = await (await browser.newContext({ storageState: await mintStorageState(a), extraHTTPHeaders: bypassHeaders() })).newPage();
  const api = await ctxFor(a);
  const viewOf = async (owner: string) => (await (await api.get(`/api/videos/youtube/connection?owner=${owner}`)).json()).connection;
  const revokes = () => mock.calls.filter(c => c === 'POST /revoke').length;
  const session = { title: 'QA state', description: '', privacy: 'unlisted', sizeBytes: 4096, contentType: 'video/mp4' };
  try {
    await admin.from('youtube_connections').delete().eq('profile_id', a.id);
    mock.grantedScopes = null;

    // 1. Connected with uploads allowed.
    mock.signInAs(CHANNEL);
    expect(await landingOf(page, `/api/videos/youtube/start?owner=${mine}&scope=upload`)).toContain('youtube=connected');
    expect(await viewOf(mine)).toMatchObject({ channelId: CHANNEL.id, scopes: ['readonly', 'upload'] });

    // 2. A reconnect through ANOTHER Google account (it grants readonly only): the old permissions do not ride along, and the banner names the swap.
    mock.signInAs(SECOND);
    const landing = await landingOf(page, `/api/videos/youtube/start?owner=${mine}&scope=readonly`);
    expect(landing).toContain('youtube=connected');
    expect(new URL(landing).searchParams.get('was')).toBe(CHANNEL.title);
    await expect(page.locator('[data-youtube-result="connected"]')).toHaveText(`Now connected to ${SECOND.title} (was ${CHANNEL.title}).`, { timeout: 20_000 });
    expect(await viewOf(mine)).toMatchObject({ channelId: SECOND.id, channelTitle: SECOND.title, scopes: ['readonly'] });

    // 3. A row that CLAIMS a permission its token does not have: YouTube's 403 removes the claim and the answer asks once more.
    await admin.from('youtube_connections').update({ scopes: ['https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/youtube.upload'] }).eq('profile_id', a.id);
    let res = await api.post('/api/videos/youtube/upload-session', { data: { owner: mine, ...session } });
    expect(res.status(), await readErrorBody(res)).toBe(409);
    expect((await res.json()).needs_scope).toBe('upload');
    expect((await viewOf(mine)).scopes).toEqual(['readonly']);

    // 4. "Allow live broadcasts" (force-ssl) covers uploading: no second question for uploads.
    expect(await landingOf(page, `/api/videos/youtube/start?owner=${mine}&scope=live`)).toContain('youtube=connected&scope=live');
    expect((await viewOf(mine)).scopes).toEqual(['readonly', 'live']);
    res = await api.post('/api/videos/youtube/upload-session', { data: { owner: mine, ...session } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // 5. The same person connects the club too; disconnecting the PROFILE does not revoke at Google, and the club's connection still reads.
    expect(await landingOf(page, `/api/videos/youtube/start?owner=${clubRef}&scope=readonly`)).toContain('youtube=connected');
    const before = revokes();
    res = await api.delete(`/api/videos/youtube/connection?owner=${mine}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(revokes()).toBe(before);
    res = await api.get(`/api/videos/youtube/channel-uploads?owner=${clubRef}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // 6. The Full game flow follows the picked owner: the profile has no channel (the Connect door); pick the club at Where and the Link step shows the club's channel.
    await page.goto('/videos/new');
    await expect(page.locator('[data-new-video-youtube="connect"]')).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-new-video] input[type="url"]').fill('https://www.youtube.com/watch?v=e2eSecond01');
    await page.locator('[data-step-next]').click();
    await page.locator('[data-step-next]').click();
    await page.locator('[data-new-video-where] label', { hasText: clubName }).locator('input[name="owner"]').check();
    await page.locator('[data-step-back]').click();
    await page.locator('[data-step-back]').click();
    await expect(page.locator('[data-channel-picker]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-new-video-youtube="connect"]')).toHaveCount(0);

    // 7. The LAST connection's disconnect does revoke at Google.
    res = await api.delete(`/api/videos/youtube/connection?owner=${clubRef}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(revokes()).toBe(before + 1);
  } finally {
    mock.grantedScopes = null;
    await admin.from('youtube_connections').delete().eq('profile_id', a.id);
    await admin.from('youtube_connections').delete().eq('org_id', club.id);
    await deleteQaOrgs(admin, [club.id]);
    await api.dispose();
    await page.context().close();
  }
});

