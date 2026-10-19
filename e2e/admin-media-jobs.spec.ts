import { test, expect, request as pwRequest, type APIRequestContext } from './helpers/test';
import { adminSignIn } from './helpers/admin';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup } from './helpers/cleanup';
import {
  adminClient, adminEmailForE2E, apiAs, bypassHeaders, createQaUser, deleteQaUser, mintStorageState, readErrorBody, E2E_BASE_URL,
} from './helpers/qa-user';

// The media worker's door (video posters PR 7, Oct 13 2026; migration 261).
// A 2 s H.264 clip (e2e/fixtures/clip-h264.mp4, made by ffmpeg-static) goes
// up through the direct-upload door: `complete` now answers the codec the
// server READ (`avc`), the dims and the duration; a post made from it stores
// `codec = 'avc'` and is NOT processing (only HEVC is). Then the admin route:
// the gate (anonymous 401, an athlete 403, a bad action 400), the plan (dry
// lists our row as a `poster` job and writes nothing; live enqueues it), a
// dry tick runs nothing, a live tick runs ffmpeg HERE and stamps the row —
// a poster beside the clip, a blur hash, the probe's width — and the poster
// proxies as a JPEG. Then the dashboard panel renders. Skips without
// E2E_ADMIN_EMAIL; skips pre-261.
const adminEmail = adminEmailForE2E();
const CLIP = join(process.cwd(), 'e2e', 'fixtures', 'clip-h264.mp4');

async function uploadClip(api: APIRequestContext): Promise<{ url: string; body: Record<string, unknown> }> {
  const bytes = readFileSync(CLIP);
  const intent = await api.post('/api/upload/post-media/intent', { data: { type: 'video/mp4', size: bytes.length } });
  expect(intent.ok(), await intent.text()).toBe(true);
  const { path, signedUrl } = await intent.json();
  expect((await api.put(signedUrl, { data: bytes, headers: { 'Content-Type': 'video/mp4' } })).ok()).toBe(true);
  const complete = await api.post('/api/upload/post-media/complete', { data: { path, type: 'video/mp4' } });
  expect(complete.ok(), await complete.text()).toBe(true);
  const body = (await complete.json()) as Record<string, unknown>;
  return { url: body.url as string, body };
}

test('admin: a clip\'s codec is read at completion; the media worker plans, runs and stamps a poster + blur; the panel renders', async ({ browser }) => {
  test.skip(!adminEmail, 'E2E_ADMIN_EMAIL unset — set it to an address in the target build\'s ADMIN_EMAILS');
  test.setTimeout(240_000);
  const admin = adminClient();
  const probe = await admin.from('media_jobs').select('id').limit(1);
  test.skip(!!probe.error && (probe.error.code === '42P01' || probe.error.code === 'PGRST205'), 'migration 261 not applied on this target');

  const qa = await apiAs('state.json');
  const anon = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: bypassHeaders() });
  const athlete = await createQaUser({ displayName: 'Clip Carver', firstName: 'Clip', lastName: 'Carver' });
  const adminUser = await createQaUser({ email: adminEmail!, displayName: 'Edge QA Admin', firstName: 'Edge', lastName: 'Admin' });
  const athleteApi = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(athlete), extraHTTPHeaders: bypassHeaders() });
  const adminApi = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(adminUser), extraHTTPHeaders: bypassHeaders() });
  await adminSignIn(adminApi, adminUser);
  const ctx = await browser.newContext({ storageState: await mintStorageState(adminUser) });
  await adminSignIn(ctx, adminUser);
  let postId = '';
  let mediaId = '';
  const storagePaths: string[] = [];
  try {
    // The probe at completion.
    const { url, body } = await uploadClip(athleteApi);
    expect(body.codec, 'the server read the codec').toBe('avc');
    expect(body.width).toBe(320);
    expect(body.height).toBe(240);
    expect(Number(body.duration)).toBeGreaterThan(1.5);
    expect(body.processing, 'an H.264 clip is never processing').toBeUndefined();
    storagePaths.push(url.split('/uploads/')[1]);

    // A post from it — the codec stored, no poster yet, not processing.
    const created = await athleteApi.post('/api/posts', {
      data: { postType: 'general', caption: `media jobs ${Date.now()}`, media: [{ url, type: 'video', sortOrder: 0, codec: body.codec, width: body.width, height: body.height, duration: body.duration }] },
    });
    expect(created.ok(), await readErrorBody(created)).toBe(true);
    postId = (await created.json()).post.id as string;
    const row = await admin.from('post_media').select('id, codec, processing_at, thumbnail_url, blur_hash, media_url').eq('post_id', postId).single();
    expect(row.error, row.error?.message).toBeNull();
    mediaId = row.data!.id as string;
    expect(row.data).toMatchObject({ codec: 'avc', processing_at: null, thumbnail_url: null, blur_hash: null });

    // The gate.
    expect((await anon.get('/api/admin/media-jobs')).status()).toBe(401);
    expect((await qa.post('/api/admin/media-jobs', { data: { action: 'plan' } })).status()).toBe(403);
    expect((await adminApi.post('/api/admin/media-jobs', { data: { action: 'everything' } })).status()).toBe(400);

    // The WRITER enqueued the clip's job at post (PR 8) — no owner action. The plan still LISTS the row
    // (a dry plan counts what needs a job), and a live plan enqueues nothing: one open job per target.
    const job = await admin.from('media_jobs').select('id, kind, status, source_path, origin').eq('target_id', mediaId).single();
    expect(job.data).toMatchObject({ kind: 'poster', status: 'queued', origin: 'upload' });
    expect(job.data!.source_path).toBe(storagePaths[0]);
    const planDry = await adminApi.post('/api/admin/media-jobs', { data: { action: 'plan', tables: ['post_media'], limit: 1 } });
    expect(planDry.ok(), await readErrorBody(planDry)).toBe(true);
    const planDryBody = await planDry.json();
    expect(planDryBody).toMatchObject({ ok: true, dryRun: true, enqueued: 0 });
    expect(planDryBody.counts['post_media:poster']).toBe(1);
    expect(planDryBody.sample).toEqual([{ table: 'post_media', id: mediaId, kind: 'poster' }]);
    const planLive = await adminApi.post('/api/admin/media-jobs', { data: { action: 'plan', tables: ['post_media'], limit: 1, dryRun: false } });
    expect(planLive.ok(), await readErrorBody(planLive)).toBe(true);
    expect((await planLive.json()).enqueued, 'the open job is never doubled').toBe(0);
    expect((await admin.from('media_jobs').select('id').eq('target_id', mediaId)).data).toHaveLength(1);

    // A dry tick runs nothing.
    const dry = await adminApi.post('/api/admin/media-jobs', { data: { action: 'run' } });
    expect(dry.ok(), await readErrorBody(dry)).toBe(true);
    const dryBody = await dry.json();
    expect(dryBody.dryRun).toBe(true);
    expect(dryBody.outcomes.every((o: { outcome: string }) => o.outcome === 'skipped')).toBe(true);
    expect((await admin.from('media_jobs').select('status').eq('id', job.data!.id).single()).data!.status).toBe('queued');

    // A live tick: ffmpeg runs here; our job reaches done (another queued job on a shared target may take the first tick).
    let done = false;
    for (let i = 0; i < 3 && !done; i++) {
      const live = await adminApi.post('/api/admin/media-jobs', { data: { action: 'run', dryRun: false } });
      expect(live.ok(), await readErrorBody(live)).toBe(true);
      const liveBody = await live.json();
      expect(liveBody.ok, JSON.stringify(liveBody)).toBe(true);
      const mine = liveBody.outcomes.find((o: { id: string }) => o.id === job.data!.id);
      if (mine) {
        expect(mine.outcome, JSON.stringify(mine)).toBe('done');
        done = true;
      }
    }
    expect(done, 'our job ran').toBe(true);
    const after = await admin.from('post_media').select('media_url, codec, processing_at, thumbnail_url, blur_hash, width, height, transcode_source_url').eq('id', mediaId).single();
    expect(after.data!.media_url, 'an H.264 clip keeps its file').toBe(row.data!.media_url);
    expect(after.data!.transcode_source_url).toBeNull();
    expect(after.data!.thumbnail_url).toMatch(new RegExp(`/uploads/posts/${athlete.id}/[0-9a-f-]{36}\\.jpg$`));
    expect(after.data!.blur_hash).toMatch(/^[A-Za-z0-9+/]{8,64}={0,2}$/);
    expect(after.data!.width).toBe(320);
    expect(after.data!.processing_at).toBeNull();
    storagePaths.push((after.data!.thumbnail_url as string).split('/uploads/')[1]);
    const jobAfter = await admin.from('media_jobs').select('status, poster_url, blur_hash, output_url').eq('id', job.data!.id).single();
    expect(jobAfter.data).toMatchObject({ status: 'done', poster_url: after.data!.thumbnail_url, blur_hash: after.data!.blur_hash, output_url: null });

    // The poster reaches a viewer as a JPEG through the post's own read.
    const read = await athleteApi.get(`/api/posts?postId=${postId}`);
    expect(read.ok(), await readErrorBody(read)).toBe(true);
    const media = (await read.json()).post.media[0];
    expect(media?.thumbnail_url, 'the post carries the proxied poster').toMatch(/^\/api\/media\//);
    expect(media?.blur_hash).toBe(after.data!.blur_hash);
    const poster = await athleteApi.get(media.thumbnail_url);
    expect(poster.ok()).toBe(true);
    expect(poster.headers()['content-type']).toMatch(/^image\/jpeg/);

    // The panel.
    const page = await ctx.newPage();
    await page.goto('/admin');
    const panel = page.locator('[data-media-jobs-panel]');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel.locator('[data-media-jobs-counts]')).toContainText('done', { timeout: 20_000 });
    await expect(panel.getByRole('button', { name: 'Dry run a tick' })).toBeEnabled();
  } finally {
    await cleanup('admin-media-jobs', [
      () => mediaId && admin.from('media_jobs').delete().eq('target_id', mediaId),
      () => postId && admin.from('posts').delete().eq('id', postId),
      () => storagePaths.length && admin.storage.from('uploads').remove(storagePaths),
      () => deleteQaUser(athlete.id),
      () => deleteQaUser(adminUser.id),
      () => ctx.close(),
      () => adminApi.dispose(),
      () => athleteApi.dispose(),
      () => anon.dispose(),
      () => qa.dispose(),
    ]);
  }
});
