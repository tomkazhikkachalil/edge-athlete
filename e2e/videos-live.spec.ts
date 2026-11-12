import { test, expect, request as pwRequest, type APIRequestContext } from './helpers/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, loadQaUser, mintStorageState, readErrorBody, resetRateBucket, type QaUser } from './helpers/qa-user';
import { startYouTubeMock, type YouTubeMock } from './helpers/youtube-mock';
import { seedOwnChannel } from './helpers/own-channel';

// Videos program Phase 4a (Nov 5 2026): a linked broadcast the app knows is
// live. The person links a scheduled broadcast (a youtube.com/live/<id> link)
// → UPCOMING with its time; the stand-in flips it live → the LIVE pill on the
// card and the page, "Now" marks a highlight at the server's offset into the
// stream; the stand-in ends it → the archive (ended, the duration filled) and
// the marker still seeks the recording; the quota running out leaves the
// state alone. The TTL is skipped by dating live_checked_at back — the rule
// itself is unit-tested (live-rules.test.ts).

const LIVE_ID = 'e2eLive0001';
const past = (ms: number) => new Date(Date.now() - ms).toISOString();
const future = (ms: number) => new Date(Date.now() + ms).toISOString();

async function ctxFor(u: QaUser): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(u), extraHTTPHeaders: bypassHeaders() });
}

let mock: YouTubeMock;
test.beforeAll(async () => { mock = await startYouTubeMock(); });
test.afterAll(async () => { await mock.close(); });

test('a linked broadcast: upcoming → live (the pill, "Now") → ended (the archive); the quota running out keeps the last truth', async ({ browser }) => {
  test.setTimeout(150_000);
  const a = loadQaUser('user.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'video-write', a.id);
  const api = await ctxFor(a);
  const stranger = await ctxFor(loadQaUser('user-b.json'));
  const page = await (await browser.newContext({ storageState: await mintStorageState(a), extraHTTPHeaders: bypassHeaders() })).newPage();
  let videoId: string | null = null;
  const stale = () => admin.from('videos').update({ live_checked_at: past(10 * 60_000) }).eq('id', videoId!);
  try {
    await admin.from('videos').delete().eq('profile_id', a.id).eq('provider_video_id', LIVE_ID);
    await seedOwnChannel(admin, { profileId: a.id }, a.id); // only the connected channel (Nov 11): the broadcast is this channel's

    // 1. Link a scheduled broadcast: the first read happens on the link — upcoming, with its time.
    const startsAt = future(30 * 60_000);
    mock.live.set(LIVE_ID, { content: 'upcoming', scheduledStartTime: startsAt, title: 'Club final — live' });
    let res = await api.post('/api/videos', { data: { url: `https://www.youtube.com/live/${LIVE_ID}`, title: 'Club final (live)' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const created = (await res.json()).video as { id: string; live_status: string; scheduled_start_at: string | null; duration_ms: number | null };
    videoId = created.id;
    expect(created.live_status).toBe('upcoming');
    expect(Date.parse(created.scheduled_start_at ?? '')).toBe(Date.parse(startsAt)); // Postgres spells the offset its own way
    expect(mock.calls.filter(c => c === 'GET /youtube/v3/videos').length).toBeGreaterThanOrEqual(1);

    // The card on the Videos tab says when, from the row.
    await page.goto(`/athlete?tab=videos`);
    const card = page.locator(`[data-video-card="${videoId}"]`);
    await expect(card).toHaveAttribute('data-video-card-live', 'upcoming');
    await expect(card).toContainText(/Live (today|tomorrow|.+ at )/);

    // 2. It goes live. Within the TTL nothing is asked; once stale, the next look reads it.
    const calls = mock.calls.filter(c => c === 'GET /youtube/v3/videos').length;
    mock.live.set(LIVE_ID, { content: 'live', scheduledStartTime: startsAt, actualStartTime: past(90_000) });
    res = await api.get(`/api/videos/${videoId}`);
    expect((await res.json()).video.live_status).toBe('upcoming'); // inside the TTL: the last truth, no read
    expect(mock.calls.filter(c => c === 'GET /youtube/v3/videos').length).toBe(calls);
    await stale();
    res = await api.get(`/api/videos/${videoId}`);
    const live = (await res.json()).video as { live_status: string; live_started_at: string | null };
    expect(live.live_status).toBe('live');
    expect(live.live_started_at).not.toBeNull();
    expect(mock.calls.filter(c => c === 'GET /youtube/v3/videos').length).toBe(calls + 1);

    // PR B: the broadcast is on Live Now for its owner (the /live page's card), not for a stranger (the QA profile is private).
    res = await api.get('/api/videos/live-now');
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(((await res.json()).videos as Array<{ id: string }>).map(v => v.id)).toContain(videoId);
    const strangerSees = ((await (await stranger.get('/api/videos/live-now')).json()).videos as Array<{ id: string }>).map(v => v.id);
    expect(strangerSees).not.toContain(videoId);
    await page.goto('/live');
    await expect(page.locator(`[data-live-broadcast-card="${videoId}"]`)).toBeVisible();
    // 300: the header's dot counts it — the pulse mirrors live-now for the owner, and the parity holds.
    const pulse = (await (await api.get('/api/me/pulse')).json()).liveNow as { golf: number; events: number; broadcasts: number; total: number };
    expect(pulse.broadcasts).toBeGreaterThanOrEqual(1);
    expect(pulse.broadcasts).toBe(((await (await api.get('/api/videos/live-now?count=1')).json()) as { count: number }).count);
    expect(pulse.total).toBe(pulse.golf + pulse.events + pulse.broadcasts);

    // The page: the pill, the "Now" button, a marker at the server's offset into the stream.
    await page.goto(`/videos/${videoId}`);
    await expect(page.locator('[data-video-live="live"]')).toBeVisible();
    await page.locator('[data-highlight-add]').click();
    await expect(page.locator('[data-highlight-now]')).toBeVisible();
    await page.locator('[data-highlight-now]').click();
    await expect(page.locator('[data-highlight-time]')).toHaveValue(/^1:[23]\d$/); // ~90 s in
    await page.locator('[data-highlight-label]').fill('Opening goal');
    await page.locator('[data-highlight-save]').click();
    await expect(page.locator('[data-video-highlights="1"]')).toBeVisible();
    res = await api.get(`/api/videos/${videoId}`);
    const marks = (await res.json()).highlights as Array<{ start_ms: number; meta: { live?: boolean } }>;
    expect(marks).toHaveLength(1);
    expect(marks[0].meta.live).toBe(true);
    expect(marks[0].start_ms).toBeGreaterThanOrEqual(85_000);
    expect(marks[0].start_ms).toBeLessThan(130_000);

    // A device cannot stamp its own time: the server's clock wins; and "Now" is refused once the stream is over.
    res = await api.post(`/api/videos/${videoId}/highlights`, { data: { start_ms: 5, label: 'Device says five', meta: { live: true } } });
    expect(res.status()).toBe(201);
    expect(((await res.json()).highlight as { start_ms: number }).start_ms).toBeGreaterThan(85_000);

    // 3. The stream ends: the archive — ended, the duration filled; the marker still seeks the recording.
    mock.live.set(LIVE_ID, { content: 'none', scheduledStartTime: startsAt, actualStartTime: past(3 * 3_600_000), actualEndTime: past(60_000), durationIso: 'PT2H58M' });
    await stale();
    res = await api.get(`/api/videos/${videoId}`);
    const ended = (await res.json()).video as { live_status: string; duration_ms: number | null; live_ended_at: string | null };
    expect(ended.live_status).toBe('ended');
    expect(ended.duration_ms).toBe((2 * 60 + 58) * 60_000);
    expect(ended.live_ended_at).not.toBeNull();
    res = await api.post(`/api/videos/${videoId}/highlights`, { data: { start_ms: 5, label: 'Too late', meta: { live: true } } });
    expect(res.status()).toBe(409);
    await page.goto(`/videos/${videoId}`);
    await expect(page.locator('[data-video-live="ended"]')).toBeVisible();
    await page.locator('[data-highlight-play]').first().click();
    await expect(page.locator('iframe[src*="youtube-nocookie.com"]')).toHaveAttribute('src', /start=(8[5-9]|9\d|1[0-2]\d)&/);

    // PR B: an ended broadcast is off Live Now.
    expect(((await (await api.get('/api/videos/live-now')).json()).videos as Array<{ id: string }>).map(v => v.id)).not.toContain(videoId);

    // 4. An archive is never asked about again; the quota running out leaves a live row's last truth.
    const before = mock.calls.filter(c => c === 'GET /youtube/v3/videos').length;
    await stale();
    await api.get(`/api/videos/${videoId}`);
    expect(mock.calls.filter(c => c === 'GET /youtube/v3/videos').length).toBe(before);
    await admin.from('videos').update({ live_status: 'live', live_checked_at: past(10 * 60_000) }).eq('id', videoId);
    mock.quota(true);
    res = await api.get(`/api/videos/${videoId}`);
    expect(res.status()).toBe(200);
    expect((await res.json()).video.live_status).toBe('live');
    const { data: parked } = await admin.from('videos').select('live_checked_at').eq('id', videoId).single();
    expect(Date.parse((parked as { live_checked_at: string }).live_checked_at)).toBeGreaterThan(Date.now() + 5 * 60_000);
    mock.quota(false);
  } finally {
    if (videoId) await api.delete(`/api/videos/${videoId}`).catch(() => undefined);
    mock.live.clear();
    await admin.from('youtube_connections').delete().eq('profile_id', a.id);
    await api.dispose();
    await stranger.dispose();
    await page.context().close();
  }
});
