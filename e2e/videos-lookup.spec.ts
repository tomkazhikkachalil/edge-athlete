import { test, expect, request as pwRequest, type APIRequestContext } from './helpers/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, loadQaUser, mintStorageState, readErrorBody, resetRateBucket, type QaUser } from './helpers/qa-user';
import { startYouTubeMock, type YouTubeMock } from './helpers/youtube-mock';
import { seedOwnChannel } from './helpers/own-channel';

// Paste and go (Nov 6 2026): a pasted link reads itself from YouTube — the
// title and the duration fill in, a private video is refused before Save,
// a video with embedding off is allowed with the sentence and the page shows
// the watch door, and the chapters in the description become the first
// highlights in ONE write. Against the stand-in Google through the key.

const DESC = ['The club final', '0:00 Warm-up', '12:30 Kick-off', '58:00 Second half', '1:45:00 Final whistle'].join('\n');

async function ctxFor(u: QaUser): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(u), extraHTTPHeaders: bypassHeaders() });
}

let mock: YouTubeMock;
test.beforeAll(async () => { mock = await startYouTubeMock(); });
test.afterAll(async () => { await mock.close(); });

test('paste and go: the title and duration fill in, chapters become highlights in one write, a private video is refused, embedding off opens on YouTube', async ({ browser }) => {
  test.setTimeout(150_000);
  const a = loadQaUser('user.json');
  const admin = adminClient();
  for (const bucket of ['video-write', 'video-lookup'] as const) await resetRateBucket(admin, bucket, a.id);
  const api = await ctxFor(a);
  const page = await (await browser.newContext({ storageState: await mintStorageState(a), extraHTTPHeaders: bypassHeaders() })).newPage();
  const ids: string[] = [];
  try {
    mock.live.set('e2eChapt001', { content: 'none', title: 'Club Final 2026 — full game', durationIso: 'PT1H50M', description: DESC, embeddable: true, privacy: 'public' });
    mock.live.set('e2ePrivat01', { content: 'none', title: 'Private one', durationIso: 'PT1M', privacy: 'private', embeddable: true });
    mock.live.set('e2eNoEmbed1', { content: 'none', title: 'No embed', durationIso: 'PT2M', privacy: 'public', embeddable: false });
    for (const id of ['e2eChapt001', 'e2ePrivat01', 'e2eNoEmbed1']) await admin.from('videos').delete().eq('profile_id', a.id).eq('provider_video_id', id);
    await seedOwnChannel(admin, { profileId: a.id }, a.id); // only the connected channel (Nov 11): the stand-in's videos are this channel's

    // 1. The lookup route itself.
    let res = await api.get('/api/videos/youtube/lookup?id=e2eChapt001');
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const lookup = (await res.json()).lookup as { available: boolean; title: string; durationMs: number; chapters: Array<{ startMs: number; label: string }>; embeddable: boolean };
    expect(lookup).toMatchObject({ available: true, title: 'Club Final 2026 — full game', durationMs: 110 * 60_000, embeddable: true });
    expect(lookup.chapters.map(c => c.label)).toEqual(['Warm-up', 'Kick-off', 'Second half', 'Final whistle']);
    expect((await api.get('/api/videos/youtube/lookup?id=nope')).status()).toBe(400);

    // 1b. Only the connected channel (Nov 11 2026): the same read says WHOSE the video is, for the owner asked about.
    res = await api.get(`/api/videos/youtube/lookup?id=e2eChapt001&owner=profile:${a.id}`);
    expect((await res.json()).lookup).toMatchObject({ channel: 'own', channelTitle: 'QA Seeded Channel' });
    mock.videoChannels.set('e2eOther001', 'UCe2eSomeoneElseAbcdefgh');
    res = await api.get(`/api/videos/youtube/lookup?id=e2eOther001&owner=profile:${a.id}`);
    expect((await res.json()).lookup).toMatchObject({ channel: 'other' });
    //     In the form: another channel's link says so under the preview, and the API refuses it (the step rule is unit-pinned).
    await page.goto('/videos/new');
    await page.locator('[data-new-video-url]').fill('https://www.youtube.com/watch?v=e2eOther001');
    await expect(page.locator('[data-new-video-channel="other"]')).toContainText('QA Seeded Channel', { timeout: 20_000 });
    res = await api.post('/api/videos', { data: { url: 'https://www.youtube.com/watch?v=e2eOther001', title: 'not mine' } });
    expect(res.status()).toBe(403);
    expect(await res.json()).toMatchObject({ channel: 'other' });
    //     A video YouTube does not have: 404, never a row.
    res = await api.post('/api/videos', { data: { url: 'https://www.youtube.com/watch?v=e2eNoSuch01', title: 'nothing' } });
    expect(res.status()).toBe(404);

    // 2. From the page: the title and the duration fill in; four chapters offer themselves; Save makes the row and the four highlights.
    await page.goto('/videos/new');
    await page.locator('[data-new-video-url]').fill('https://www.youtube.com/watch?v=e2eChapt001');
    await expect(page.locator('[data-new-video-lookup-title]')).toContainText('Club Final 2026 — full game');
    await expect(page.locator('[data-new-video-lookup-duration]')).toHaveText('1:50:00');
    await expect(page.locator('[data-new-video-chapters]')).toHaveAttribute('data-new-video-chapters', '4');
    await page.locator('[data-step-next]').click();
    await expect(page.locator('[data-new-video-title]')).toHaveValue('Club Final 2026 — full game');
    await page.locator('[data-step-next]').click();
    await page.locator('[data-new-video-where] input[name="owner"]').first().check();
    await page.locator('[data-step-finish]').click();
    await expect.poll(() => page.url(), { timeout: 20_000 }).toMatch(/\/videos\/[0-9a-f-]{36}$/);
    const id1 = page.url().split('/').pop()!;
    ids.push(id1);
    await expect(page.locator('[data-video-highlights="4"]')).toBeVisible();
    res = await api.get(`/api/videos/${id1}`);
    const body = (await res.json()) as { video: { duration_ms: number | null }; highlights: Array<{ start_ms: number; end_ms: number | null; label: string }> };
    expect(body.highlights.map(h => [h.start_ms, h.end_ms, h.label])).toEqual([[0, 750_000, 'Warm-up'], [750_000, 3_480_000, 'Kick-off'], [3_480_000, 6_300_000, 'Second half'], [6_300_000, 6_600_000, 'Final whistle']]);
    // A second import is refused: the list is not empty.
    res = await api.post(`/api/videos/${id1}/highlights/import`, { data: { highlights: [{ start_ms: 1000, end_ms: null, label: 'again', meta: {} }] } });
    expect(res.status()).toBe(409);

    // 3. A private video is refused before Save, with the sentence.
    await page.goto('/videos/new');
    await page.locator('[data-new-video-url]').fill('https://youtu.be/e2ePrivat01');
    await expect(page.locator('[data-new-video-lookup="private"]')).toBeVisible();
    await expect(page.locator('[data-step-next]')).toBeDisabled();
    await expect(page.locator('[data-step-refusal]')).toContainText('private on YouTube');

    // 4. Embedding off: allowed with the sentence; the page shows the watch door instead of a frame.
    await page.locator('[data-new-video-url]').fill('https://www.youtube.com/watch?v=e2eNoEmbed1');
    await expect(page.locator('[data-new-video-lookup="no_embed"]')).toBeVisible();
    await expect(page.locator('[data-step-next]')).toBeEnabled();
    await page.locator('[data-step-next]').click();
    await page.locator('[data-step-next]').click();
    await page.locator('[data-new-video-where] input[name="owner"]').first().check();
    await page.locator('[data-step-finish]').click();
    await expect.poll(() => page.url(), { timeout: 20_000 }).toMatch(/\/videos\/[0-9a-f-]{36}$/);
    ids.push(page.url().split('/').pop()!);
    await expect(page.locator('[data-video-no-embed]')).toBeVisible();
    await expect(page.locator('[data-video-no-embed]')).toHaveAttribute('href', 'https://www.youtube.com/watch?v=e2eNoEmbed1');
    expect(await page.locator('[data-video-player]').count()).toBe(0);
  } finally {
    for (const id of ids) await api.delete(`/api/videos/${id}`).catch(() => undefined);
    mock.live.clear();
    mock.videoChannels.clear();
    await admin.from('youtube_connections').delete().eq('profile_id', a.id);
    await api.dispose();
    await page.context().close();
  }
});
