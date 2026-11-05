import { test, expect } from './helpers/test';

// Videos program Phase 2 (Nov 5 2026): a clip longer than one chunk travels
// resumable — tus against Supabase Storage with the intent's signed token —
// so a dropped connection costs a chunk, never the file. Two proofs:
//   1. the protocol from the page (the same calls tus-upload.ts makes): the
//      intent → create → one chunk → HEAD shows the offset → a wrong offset
//      is refused → the rest → complete lands under posts/;
//   2. the real client path: the diag page's "Resumable upload check" runs
//      uploadPostMedia on a three-chunk file and logs transport=tus.
// Like upload-direct.spec, the bytes are not a playable video (the finalize's
// scrub fails open and moves them as-is); the DELETE door cleans up.

const CHUNK = 6 * 1024 * 1024;

test('a three-chunk clip goes to storage resumable: create, PATCH, HEAD, a refused offset, complete @mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'brave-android', 'Playwright request routing drops a large body (the Brave lists route every request)');
  test.setTimeout(240_000);
  await page.goto('/feed');

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
  expect(supabaseUrl, 'NEXT_PUBLIC_SUPABASE_URL is loaded by the e2e env').toMatch(/^https:\/\//);
  const result = await page.evaluate(async ({ chunk, base }) => {
    const size = 2 * chunk + 4096;
    const intent = await fetch('/api/upload/post-media/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'video/mp4', size }),
    });
    if (!intent.ok) return { step: 'intent', status: intent.status, body: await intent.text() };
    const { path, token } = (await intent.json()) as { path: string; token: string };
    const endpoint = `${base}/storage/v1/upload/resumable/sign`;
    const b64 = (v: string) => btoa(v);
    const meta = [['bucketName', 'uploads'], ['objectName', path], ['contentType', 'video/mp4'], ['cacheControl', '3600']].map(([k, v]) => `${k} ${b64(v)}`).join(',');
    const create = await fetch(endpoint, { method: 'POST', headers: { 'Tus-Resumable': '1.0.0', 'Upload-Length': String(size), 'Upload-Metadata': meta, 'x-signature': token, 'x-upsert': 'false' } });
    const location = create.headers.get('location');
    if (create.status !== 201 || !location) return { step: 'create', status: create.status, body: await create.text() };
    const uploadUrl = new URL(location, endpoint).toString();
    const bytes = new Uint8Array(size);
    bytes.fill(7);
    const patch = (offset: number, end: number) =>
      fetch(uploadUrl, { method: 'PATCH', headers: { 'Tus-Resumable': '1.0.0', 'Upload-Offset': String(offset), 'Content-Type': 'application/offset+octet-stream', 'x-signature': token }, body: bytes.slice(offset, end) });
    const first = await patch(0, chunk);
    if (first.status !== 204) return { step: 'patch1', status: first.status, body: await first.text() };
    const head = await fetch(uploadUrl, { method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0', 'x-signature': token } });
    const offsetAfterOne = head.headers.get('upload-offset');
    const wrong = await patch(0, 16);
    const second = await patch(chunk, 2 * chunk);
    const third = await patch(2 * chunk, size);
    if (third.status !== 204) return { step: 'patch3', status: third.status, body: await third.text() };
    const complete = await fetch('/api/upload/post-media/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
    const payload = await complete.json().catch(() => ({}));
    return { step: 'complete', status: complete.status, offsetAfterOne, wrongStatus: wrong.status, secondStatus: second.status, finalOffset: third.headers.get('upload-offset'), payload };
  }, { chunk: CHUNK, base: supabaseUrl });

  expect(result, JSON.stringify(result)).toMatchObject({ step: 'complete', status: 200, wrongStatus: 409, secondStatus: 204 });
  const r = result as { offsetAfterOne: string; finalOffset: string; payload: { url: string; type: string } };
  expect(Number(r.offsetAfterOne)).toBe(CHUNK);
  expect(Number(r.finalOffset)).toBe(2 * CHUNK + 4096);
  expect(r.payload.type).toBe('video');
  expect(r.payload.url).toMatch(/\/uploads\/posts\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.mp4$/);

  const filePath = r.payload.url.slice(r.payload.url.indexOf('posts/'));
  const removed = await page.evaluate(async p => (await fetch(`/api/upload/post-media?filePath=${encodeURIComponent(p)}`, { method: 'DELETE' })).status, filePath);
  expect(removed).toBe(200);
});

test('the real client path: the diag page uploads a three-chunk file resumable and says so @mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'brave-android', 'Playwright request routing drops a large body (the Brave lists route every request)');
  test.setTimeout(240_000);
  await page.goto('/app/diag/media');
  await expect(page.getByRole('heading', { name: 'Media diagnostic' })).toBeVisible({ timeout: 20_000 });
  await page.locator('[data-diag-resumable]').click();
  const log = page.locator('pre, [data-diag-log]').first();
  await expect(log).toContainText('[resumable] ok transport=tus', { timeout: 200_000 });
  const text = await log.innerText();
  expect(text).toContain('[resumable] progress 100%');
  const url = /→ (https:\S+)/.exec(text)?.[1];
  expect(url, text).toBeTruthy();
  expect(url!).toMatch(/\/uploads\/posts\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.mp4$/);
  const filePath = url!.slice(url!.indexOf('posts/'));
  const removed = await page.evaluate(async p => (await fetch(`/api/upload/post-media?filePath=${encodeURIComponent(p)}`, { method: 'DELETE' })).status, filePath);
  expect(removed).toBe(200);
});
