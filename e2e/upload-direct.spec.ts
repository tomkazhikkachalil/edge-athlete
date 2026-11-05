import { test, expect } from './helpers/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// Direct-to-storage upload (Oct 2026, src/lib/media/upload-rules.ts). The old
// door carried every byte through a Vercel function, and Vercel refuses a
// function request body over 4.5 MB — so this spec only PROVES anything
// against a real deployment (a preview or prod). Locally there is no such
// cap; it still pins the three-step contract and the refusals.
//
// The bytes are not a playable video: the finalize's metadata scrub fails
// OPEN on them and the object is moved as-is — exactly the fail-open path.

const OTHER_OWNER = '00000000-0000-4000-8000-0000000000ff';

test('a 20 MB video goes straight to storage and lands under posts/ @mobile', async ({ page }, testInfo) => {
  // Oct 19 2026: the brave-android project routes every request through
  // Playwright (the Brave lists, e2e/helpers/brave.ts), and a routed 20 MB
  // request body is dropped about half the time — plain android with one
  // catch-all page.route failed 2 of 4 the same way ("Failed to fetch"), and
  // passes every time unrouted. Real Brave routes nothing through a test
  // tool; that the storage host is on none of Brave's lists is
  // `npm run check:blocklists`.
  test.skip(testInfo.project.name === 'brave-android', 'Playwright request routing drops a 20 MB body (the Brave lists route every request)');
  test.setTimeout(180_000);
  await page.goto('/feed');

  const result = await page.evaluate(async () => {
    const size = 20 * 1024 * 1024;
    const intent = await fetch('/api/upload/post-media/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'video/mp4', size }),
    });
    if (!intent.ok) return { step: 'intent', status: intent.status, body: await intent.text() };
    const { path, signedUrl } = await intent.json();

    const bytes = new Uint8Array(size);
    bytes.fill(1);
    const put = await fetch(signedUrl, {
      method: 'PUT',
      headers: { 'content-type': 'video/mp4', 'x-upsert': 'false' },
      body: new Blob([bytes], { type: 'video/mp4' }),
    });
    if (!put.ok) return { step: 'put', status: put.status, body: await put.text() };

    const complete = await fetch('/api/upload/post-media/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    const payload = await complete.json().catch(() => ({}));
    return { step: 'complete', status: complete.status, path, payload };
  });

  expect(result, JSON.stringify(result)).toMatchObject({ step: 'complete', status: 200 });
  const payload = (result as { payload: { url: string; type: string } }).payload;
  expect(payload.type).toBe('video');
  expect(payload.url).toMatch(/\/uploads\/posts\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.mp4$/);

  // Clean up through the owner's own DELETE door.
  const filePath = payload.url.slice(payload.url.indexOf('posts/'));
  const removed = await page.evaluate(
    async p => (await fetch(`/api/upload/post-media?filePath=${encodeURIComponent(p)}`, { method: 'DELETE' })).status,
    filePath
  );
  expect(removed).toBe(200);
});

test('the doors refuse an oversize file, a bad type and someone else\'s upload', async ({ page }) => {
  await page.goto('/feed');
  const statuses = await page.evaluate(async other => {
    const post = (url: string, body: unknown) =>
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(
        r => r.status
      );
    return {
      oversize: await post('/api/upload/post-media/intent', { type: 'video/mp4', size: 51 * 1024 * 1024 }),
      badType: await post('/api/upload/post-media/intent', { type: 'text/html', size: 10 }),
      forged: await post('/api/upload/post-media/complete', {
        path: `incoming/${other}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.mp4`,
      }),
      shapeless: await post('/api/upload/post-media/complete', { path: '../../etc/passwd' }),
    };
  }, OTHER_OWNER);
  expect(statuses).toEqual({ oversize: 413, badType: 400, forged: 403, shapeless: 403 });
});

// A profile cover by the direct route (Nov 2 2026, SCALE_AUDIT hole #9): a
// 6 MB PNG — the size the old FormData door could never carry under Vercel's
// 4.5 MB — goes intent → PUT → POST /api/profile/photo, lands under
// covers/<me>/ and the row names it; the refusals by name.
test('a 6 MB cover goes straight to storage and the row names it; the refusals @mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'brave-android', 'Playwright request routing drops a large body (the Brave lists route every request)');
  test.setTimeout(180_000);
  await page.goto('/feed');
  const result = await page.evaluate(async () => {
    // Noise does not compress: a 1500 px square PNG of random pixels is ~6 MB.
    const canvas = document.createElement('canvas');
    canvas.width = 1500; canvas.height = 1500;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(1500, 1500);
    // getRandomValues takes 64 KB at a time.
    for (let off = 0; off < img.data.length; off += 65536) crypto.getRandomValues(img.data.subarray(off, Math.min(off + 65536, img.data.length)));
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    ctx.putImageData(img, 0, 0);
    const blob: Blob = await new Promise(res => canvas.toBlob(b => res(b!), 'image/png'));
    const size = blob.size;
    const intent = await fetch('/api/upload/post-media/intent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'image/png', size }) });
    if (!intent.ok) return { step: 'intent', status: intent.status, body: await intent.text() };
    const { path, signedUrl } = await intent.json();
    const put = await fetch(signedUrl, { method: 'PUT', headers: { 'content-type': 'image/png', 'x-upsert': 'false' }, body: blob });
    if (!put.ok) return { step: 'put', status: put.status, body: await put.text() };
    const save = await fetch('/api/profile/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slot: 'cover', path }) });
    const saved = await save.json().catch(() => ({}));
    const badSlot = await fetch('/api/profile/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slot: 'banner', path }) });
    const notMine = await fetch('/api/profile/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slot: 'cover', path: path.replace(/incoming\/[^/]+/, 'incoming/00000000-0000-4000-8000-0000000000ff') }) });
    return { step: 'done', size, status: save.status, saved, badSlot: badSlot.status, notMine: notMine.status };
  });
  expect(result.step, JSON.stringify(result)).toBe('done');
  if (result.step !== 'done') return;
  expect(result.size).toBeGreaterThan(4.5 * 1024 * 1024);
  expect(result.status, JSON.stringify(result.saved)).toBe(200);
  expect(result.saved.cover_url).toMatch(/\/uploads\/covers\/[0-9a-f-]+\/\d+\.png$/);
  // The row names it (the page's session is the default QA user).
  const me = loadQaUser('user.json');
  const row = (await adminClient().from('profiles').select('cover_url').eq('id', me.id).single()).data;
  expect(row?.cover_url).toBe(result.saved.cover_url);
  expect(result.badSlot).toBe(400);
  expect(result.notMine).toBe(403);
});
