import { test, expect } from '@playwright/test';

// Direct-to-storage upload (Oct 2026, src/lib/media/upload-rules.ts). The old
// door carried every byte through a Vercel function, and Vercel refuses a
// function request body over 4.5 MB — so this spec only PROVES anything
// against a real deployment (a preview or prod). Locally there is no such
// cap; it still pins the three-step contract and the refusals.
//
// The bytes are not a playable video: the finalize's metadata scrub fails
// OPEN on them and the object is moved as-is — exactly the fail-open path.

const OTHER_OWNER = '00000000-0000-4000-8000-0000000000ff';

test('a 20 MB video goes straight to storage and lands under posts/ @mobile', async ({ page }) => {
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
