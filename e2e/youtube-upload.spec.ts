import { writeFileSync } from 'node:fs';
import { test, expect } from './helpers/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, loadQaUser, mintStorageState, resetRateBucket } from './helpers/qa-user';
import { landingOf, startYouTubeMock, type MockChannel, type YouTubeMock } from './helpers/youtube-mock';

// The uploads round (Nov 10 2026): a full game outlives the hour, the tunnel
// and a reload. Here the BROWSER sends the bytes, through the real panel and
// the real loop (youtube-upload.ts), to the stand-in Google — which answers
// one chunk with a 401 (the token's hour ran out), cuts the connection on
// another, and swallows a third while the page reloads. The context bypasses
// the page's CSP for this one reason: the policy allows www.googleapis.com
// only, and the stand-in lives on 127.0.0.1. What a stand-in cannot prove —
// Google's own CORS answer on a real session — is Tom's one real upload.

const CHANNEL: MockChannel = { id: 'UCe2eUploadAbcdefghijklm', title: 'QA Upload Channel', uploads: [] };
const CHUNK = 8 * 1024 * 1024;
const SIZE = CHUNK * 2 + 1234; // three chunks

let mock: YouTubeMock;
test.beforeAll(async () => { mock = await startYouTubeMock(); });
test.afterAll(async () => { await mock.close(); });

test('a full game upload from the browser: a 401 mid-upload renews the token, a cut connection continues from YouTube\'s offset, a reload resumes with the same file — no chunk stored twice', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const a = loadQaUser('user.json');
  const admin = adminClient();
  for (const bucket of ['connection-write', 'video-write', 'video-lookup'] as const) await resetRateBucket(admin, bucket, a.id);
  const owner = `profile:${a.id}`;
  const game = testInfo.outputPath('full-game.mp4');
  writeFileSync(game, Buffer.alloc(SIZE, 7));
  const ctx = await browser.newContext({ storageState: await mintStorageState(a), extraHTTPHeaders: bypassHeaders(), bypassCSP: true });
  const page = await ctx.newPage();
  page.on('dialog', d => void d.accept()); // "Leave site?" while an upload runs
  const openPanel = async () => {
    await page.goto('/videos/new');
    await page.locator('[data-new-video-upload-door]').click({ timeout: 20_000 });
    await expect(page.locator('[data-youtube-upload]')).toBeVisible();
  };
  const keptKeys = () => page.evaluate(() => Object.keys(window.localStorage).filter(k => k.endsWith(':yt-upload')).length);
  try {
    await admin.from('youtube_connections').delete().eq('profile_id', a.id);
    mock.signInAs(CHANNEL);
    expect(await landingOf(page, `/api/videos/youtube/start?owner=${owner}&scope=upload`)).toContain('youtube=connected');

    // 1. The hour and the tunnel: after the first chunk the token is refused (401), and the third chunk's connection is cut.
    await openPanel();
    await page.locator('[data-youtube-upload-file]').setInputFiles(game);
    await page.locator('[data-youtube-upload-title]').fill('QA full game');
    mock.uploadFaults.unauthorized = 1;
    mock.uploadFaults.drop = 2;
    const tokensBefore = mock.tokensMinted();
    await page.locator('[data-youtube-upload-start="new"]').click();
    await expect(page.locator('[data-new-video-uploaded]')).toBeVisible({ timeout: 90_000 });
    expect(mock.faultsFired).toEqual(['unauthorized', 'drop']);
    expect(mock.tokensMinted()).toBe(tokensBefore + 1); // exactly one fresh token for the 401
    expect([...mock.uploaded.values()].at(-1)).toMatchObject({ size: SIZE, title: 'QA full game', privacy: 'unlisted' });
    expect([...mock.storedStarts.values()].at(-1)).toEqual([0, CHUNK, CHUNK * 2]); // each chunk stored once, in order
    // The session was opened in the app's own origin's name (Google's upload server answers CORS for that origin).
    expect(mock.calls).toContain(`ORIGIN ${new URL(E2E_BASE_URL).origin}`);
    expect(await keptKeys()).toBe(0);

    // 2. A reload mid-upload: the second chunk is swallowed (no answer), the page reloads, and the SAME file picked again resumes.
    mock.faultsFired.length = 0;
    await openPanel();
    await page.locator('[data-youtube-upload-file]').setInputFiles(game);
    await page.locator('[data-youtube-upload-title]').fill('QA resumed game');
    mock.uploadFaults.stall = 1;
    await page.locator('[data-youtube-upload-start="new"]').click();
    await expect.poll(() => mock.faultsFired, { timeout: 60_000 }).toEqual(['stall']);
    expect(await keptKeys()).toBe(1);
    await openPanel(); // a navigation away and back = the page that was sending is gone
    const kept = page.locator('[data-youtube-upload-kept]');
    await expect(kept).toContainText('full-game.mp4');
    await expect(kept).toContainText('Choose the same file again');
    await expect(page.locator('[data-youtube-upload-title]')).toHaveValue('QA resumed game');
    await page.locator('[data-youtube-upload-file]').setInputFiles(game);
    await expect(kept).toContainText('same file');
    const sessionsBefore = mock.calls.filter(c => c === 'POST /upload/youtube/v3/videos').length;
    await page.locator('[data-youtube-upload-start="resume"]').click();
    await expect(page.locator('[data-new-video-uploaded]')).toBeVisible({ timeout: 90_000 });
    expect(mock.calls.filter(c => c === 'POST /upload/youtube/v3/videos').length).toBe(sessionsBefore); // no new session: the old one went on
    expect([...mock.uploaded.values()].at(-1)).toMatchObject({ size: SIZE, title: 'QA resumed game' });
    expect([...mock.storedStarts.values()].at(-1)).toEqual([0, CHUNK, CHUNK * 2]); // the first chunk was NOT sent again
    expect(await keptKeys()).toBe(0);

    // 3. Phone width: the panel with a kept upload fits 375 px.
    mock.faultsFired.length = 0;
    mock.uploadFaults.stall = 0;
    await openPanel();
    await page.locator('[data-youtube-upload-file]').setInputFiles(game);
    await page.locator('[data-youtube-upload-title]').fill('QA narrow');
    await page.locator('[data-youtube-upload-start="new"]').click();
    await expect.poll(() => mock.faultsFired, { timeout: 60_000 }).toEqual(['stall']);
    await page.setViewportSize({ width: 375, height: 812 });
    await openPanel();
    await expect(page.locator('[data-youtube-upload-kept]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator('[data-youtube-upload-forget]').click();
    await expect(page.locator('[data-youtube-upload-kept]')).toHaveCount(0);
    expect(await keptKeys()).toBe(0);
  } finally {
    mock.uploadFaults.unauthorized = null;
    mock.uploadFaults.drop = null;
    mock.uploadFaults.stall = null;
    await admin.from('youtube_connections').delete().eq('profile_id', a.id);
    await ctx.close();
  }
});
