import { test, expect, type Page } from './helpers/test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState } from './helpers/qa-user';
import { liveWire } from './helpers/activities';

// Video posters PR 3 (Oct 13 2026): a clip added to an activity carries its
// poster — grabbed on the device after the pick, uploaded beside the clip,
// saved on the row — so the activity page's tile is the clip's own frame,
// never a black box. A photo attaches the same way.

const PHOTO = join(process.cwd(), 'e2e', 'fixtures', 'photo.png');

async function recordClip(page: Page): Promise<{ name: string; mimeType: string; buffer: Buffer } | null> {
  const canRecord = await page.evaluate(() => 'MediaRecorder' in window);
  if (!canRecord) return null;
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const ctx = canvas.getContext('2d')!;
    const stream = canvas.captureStream(30);
    const mime = MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : 'video/mp4';
    const rec = new MediaRecorder(stream, { mimeType: mime });
    const chunks: BlobPart[] = [];
    rec.ondataavailable = e => chunks.push(e.data);
    const stopped = new Promise<Blob>(resolve => { rec.onstop = () => resolve(new Blob(chunks, { type: mime })); });
    rec.start();
    const t0 = performance.now();
    await new Promise<void>(resolve => {
      const draw = () => {
        const t = performance.now() - t0;
        ctx.fillStyle = `hsl(${(t / 10) % 360}, 80%, 50%)`;
        ctx.fillRect(0, 0, 160, 120);
        if (t < 1800) requestAnimationFrame(draw);
        else { rec.stop(); resolve(); }
      };
      draw();
    });
    const blob = await stopped;
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return { data: btoa(s), mime };
  });
  return { name: base64.mime === 'video/mp4' ? 'clip.mp4' : 'clip.webm', mimeType: base64.mime, buffer: Buffer.from(base64.data, 'base64') };
}

test.beforeAll(async () => {
  const probe = await adminClient().from('activities').select('id').limit(1);
  test.skip(!!probe.error && (probe.error.code === '42P01' || probe.error.code === 'PGRST205'), 'migration 245 not applied on this target');
});

test('a clip added to an activity carries its poster; a photo attaches beside it @mobile', { tag: '@mobile' }, async ({ browser }) => {
  test.setTimeout(180_000);
  const u = await createQaUser({ displayName: 'Poster Pat', firstName: 'Poster', lastName: 'Pat' });
  const ctx = await browser.newContext({ storageState: await mintStorageState(u), extraHTTPHeaders: bypassHeaders() });
  const page = await ctx.newPage();
  const runStart = Date.UTC(2026, 7, 2, 9, 0, 0) + Math.floor(Math.random() * 1e6) * 1000;
  try {
    // A recording saved through the recorder's door (the file import left Oct 13 2026).
    const saved = await page.request.post('/api/activities', { data: { activity: liveWire({ t0: runStart, n: 600, stepM: 3, hr: 140, name: 'Poster run', type: 'run' }) } });
    expect(saved.status(), await saved.text()).toBe(201);
    const { id } = await saved.json();
    await page.goto(`/activities/${id}`);
    await expect(page.locator('[data-activity-name]')).toHaveText('Poster run', { timeout: 20_000 });

    const clip = await recordClip(page);
    test.skip(!clip, 'MediaRecorder unavailable in this browser');
    await page.setInputFiles('[data-activity-photo-input]', [clip!, { name: 'photo.png', mimeType: 'image/png', buffer: readFileSync(PHOTO) }]);
    const photos = page.locator('[data-activity-photo]');
    await expect(photos).toHaveCount(2, { timeout: 60_000 });
    // The clip's tile is its poster — never the placeholder.
    const clipTile = page.locator('[data-activity-photo] [data-media-tile="video"] [data-video-frame]');
    await expect(clipTile).toHaveAttribute('data-video-frame', 'poster', { timeout: 20_000 });
    await expect(page.locator('[data-activity-photo] [data-media-tile="image"]')).toHaveCount(1);

    const { data: rows } = await adminClient().from('activity_media').select('media_type, thumbnail_url').eq('profile_id', u.id);
    const video = (rows ?? []).find(r => r.media_type === 'video');
    expect(video?.thumbnail_url, 'the poster is on the row').toMatch(/\/uploads\/posts\//);
  } finally {
    await ctx.close().catch(() => undefined);
    await deleteQaUser(u.id).catch(() => undefined);
  }
});
