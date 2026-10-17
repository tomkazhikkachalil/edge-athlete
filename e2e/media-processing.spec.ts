import { test, expect, request as pwRequest, type APIRequestContext } from './helpers/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup } from './helpers/cleanup';
import { adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState, readErrorBody, E2E_BASE_URL } from './helpers/qa-user';

// Video posters PR 8 (Oct 13 2026): `processing` end to end. A posted clip's
// row gets its job from the WRITER (no owner action); the readers emit
// `codec` + `processing` (never the timestamp); a card whose clip the worker
// still owes shows the poster and "Processing…" and asks for itself until the
// file is playable; a ready clip plays. The HEVC conversion itself is proven
// from Tom's iPhone (the fixture is H.264 — Android and desktop decode it).
// Skips pre-261.
const CLIP = join(process.cwd(), 'e2e', 'fixtures', 'clip-h264.mp4');

async function uploadClip(api: APIRequestContext): Promise<{ url: string; codec: string }> {
  const bytes = readFileSync(CLIP);
  const intent = await api.post('/api/upload/post-media/intent', { data: { type: 'video/mp4', size: bytes.length } });
  expect(intent.ok(), await intent.text()).toBe(true);
  const { path, signedUrl } = await intent.json();
  expect((await api.put(signedUrl, { data: bytes, headers: { 'Content-Type': 'video/mp4' } })).ok()).toBe(true);
  const complete = await api.post('/api/upload/post-media/complete', { data: { path, type: 'video/mp4' } });
  expect(complete.ok(), await complete.text()).toBe(true);
  const body = await complete.json();
  return { url: body.url as string, codec: body.codec as string };
}

test('a posted clip gets its job from the writer; the readers say processing; the card shows it and refreshes when the file is ready @mobile', { tag: '@mobile' }, async ({ browser }) => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const probe = await admin.from('media_jobs').select('id').limit(1);
  test.skip(!!probe.error && (probe.error.code === '42P01' || probe.error.code === 'PGRST205'), 'migration 261 not applied on this target');

  const user = await createQaUser({ displayName: 'Proc Parker', firstName: 'Proc', lastName: 'Parker' });
  await admin.from('profiles').update({ visibility: 'public' }).eq('id', user.id);
  const api = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(user), extraHTTPHeaders: bypassHeaders() });
  const ctx = await browser.newContext({ storageState: await mintStorageState(user) });
  let postId = '';
  let mediaId = '';
  const paths: string[] = [];
  try {
    const { url, codec } = await uploadClip(api);
    expect(codec).toBe('avc');
    paths.push(url.split('/uploads/')[1]);
    const marker = `processing ${Date.now()}`;
    const created = await api.post('/api/posts', { data: { postType: 'general', caption: marker, media: [{ url, type: 'video', sortOrder: 0, codec }] } });
    expect(created.ok(), await readErrorBody(created)).toBe(true);
    postId = (await created.json()).post.id as string;

    // The writer enqueued the clip's job (no poster → `poster`) — no owner action.
    const row = await admin.from('post_media').select('id, codec, processing_at').eq('post_id', postId).single();
    mediaId = row.data!.id as string;
    expect(row.data).toMatchObject({ codec: 'avc', processing_at: null });
    await expect.poll(async () => (await admin.from('media_jobs').select('kind, status, origin').eq('target_id', mediaId).maybeSingle()).data, { timeout: 10_000 }).toMatchObject({ kind: 'poster', origin: 'upload' });

    // The readers: codec + processing, never the timestamp.
    const read = await api.get(`/api/posts?postId=${postId}`);
    expect(read.ok()).toBe(true);
    const media = (await read.json()).post.media[0];
    expect(media.codec).toBe('avc');
    expect(media.processing).toBe(false);
    expect(media.processing_at).toBeUndefined();
    const feed = await api.get('/api/posts?limit=5');
    const mine = ((await feed.json()).posts as Array<{ id: string; media: Array<Record<string, unknown>> }>).find(p => p.id === postId);
    expect(mine?.media[0]).toMatchObject({ codec: 'avc', processing: false });

    // The worker still owes the file (simulated: an HEVC row mid-conversion — the codec is part of the
    // rule: a device that DECODES hevc plays it as it is, so the chip is for the device that cannot).
    await admin.from('post_media').update({ processing_at: new Date().toISOString(), codec: 'hevc' }).eq('id', mediaId);
    const page = await ctx.newPage();
    const decodesHevc = await page.evaluate(() => { const v = document.createElement('video'); return v.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') !== ''; });
    await page.goto('/feed');
    const card = page.locator('[data-testid="post-card"]').filter({ hasText: marker }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    const frame = card.locator('[data-video-frame]').first();
    if (decodesHevc) {
      // Safari / a hardware-HEVC browser: the clip is simply ready.
      await expect(frame).toHaveAttribute('data-video-frame', /^(poster|placeholder)$/);
      await expect(card.getByRole('button', { name: 'Play video' })).toBeVisible();
    } else {
      await expect(frame).toHaveAttribute('data-video-frame', 'processing');
      await expect(card.locator('[data-video-processing]')).toHaveText(/Processing/);
      await expect(card.getByRole('button', { name: 'Play video' })).toHaveCount(0);

      // The worker's done (simulated: the H.264 file, processing cleared): the card's poll (every 15 s
      // for a fresh post) swaps it in without a reload and the play button returns.
      await admin.from('post_media').update({ processing_at: null, codec: 'avc' }).eq('id', mediaId);
      await expect(frame).toHaveAttribute('data-video-frame', /^(poster|placeholder)$/, { timeout: 40_000 });
      await expect(card.getByRole('button', { name: 'Play video' })).toBeVisible();
    }
  } finally {
    await cleanup('media-processing', [
      () => mediaId && admin.from('media_jobs').delete().eq('target_id', mediaId),
      () => postId && admin.from('posts').delete().eq('id', postId),
      () => paths.length && admin.storage.from('uploads').remove(paths),
      () => deleteQaUser(user.id),
      () => ctx.close(),
      () => api.dispose(),
    ]);
  }
});
