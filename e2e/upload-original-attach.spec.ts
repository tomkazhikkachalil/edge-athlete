import path from 'path';
import fs from 'fs';
import { test, expect } from '@playwright/test';

// The background original (Oct 4 2026): an edited video's post is created
// from its RENDER; the untouched original follows and is attached through
// PATCH /api/posts/[id]/media/[mediaId]/source. Headless Chromium has no
// h264 encoder, so the composer never produces an edited video here — this
// pins the ROUTE: owner's own finished upload only, set once, never another
// owner's object or an outside URL. The fixture photo stands in for both
// files; the route does not care about the bytes.

const FIXTURE = path.join(__dirname, 'fixtures', 'photo.png');
const OTHER_OWNER = '00000000-0000-4000-8000-0000000000ff';

async function directUpload(page: import('@playwright/test').Page, base64: string): Promise<string> {
  return page.evaluate(async b64 => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const intent = await fetch('/api/upload/post-media/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'image/png', size: bytes.length }),
    });
    if (!intent.ok) throw new Error(`intent ${intent.status}`);
    const { path: key, signedUrl } = await intent.json();
    const put = await fetch(signedUrl, {
      method: 'PUT',
      headers: { 'content-type': 'image/png', 'x-upsert': 'false' },
      body: new Blob([bytes], { type: 'image/png' }),
    });
    if (!put.ok) throw new Error(`put ${put.status}`);
    const complete = await fetch('/api/upload/post-media/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: key }),
    });
    if (!complete.ok) throw new Error(`complete ${complete.status}`);
    return (await complete.json()).url as string;
  }, base64);
}

test('the original attaches once, to the owner\'s own upload, and nowhere else', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/feed');
  const b64 = fs.readFileSync(FIXTURE).toString('base64');

  const renderUrl = await directUpload(page, b64);
  const originalUrl = await directUpload(page, b64);

  const created = await page.evaluate(async url => {
    const r = await fetch('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postType: 'general',
        caption: `original attach ${Date.now()}`,
        visibility: 'private',
        media: [{ url, type: 'image', sortOrder: 0 }],
      }),
    });
    const body = await r.json();
    return { status: r.status, postId: body.post?.id as string, mediaId: body.post?.media?.[0]?.id as string };
  }, renderUrl);
  expect(created.status).toBe(200);
  expect(created.mediaId).toBeTruthy();

  const patch = (sourceUrl: string) =>
    page.evaluate(
      async ({ postId, mediaId, sourceUrl }) =>
        (
          await fetch(`/api/posts/${postId}/media/${mediaId}/source`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourceUrl }),
          })
        ).status,
      { postId: created.postId, mediaId: created.mediaId, sourceUrl }
    );

  const foreign = originalUrl.replace(/posts\/[0-9a-f-]{36}\//, `posts/${OTHER_OWNER}/`);
  expect(await patch(foreign)).toBe(400); // another owner's object
  expect(await patch('https://example.com/evil.mp4')).toBe(400); // an outside URL
  expect(await patch(originalUrl)).toBe(200); // the owner's own finished upload
  expect(await patch(originalUrl)).toBe(409); // set once

  // The row carries it, under the proxy as every reader sees media.
  const sourceSeen = await page.evaluate(async postId => {
    const r = await fetch(`/api/posts/${postId}/media`);
    const body = await r.json();
    const rows = (body.media ?? []) as Array<{ source_url?: string | null }>;
    return rows.map(m => m.source_url ?? null);
  }, created.postId);
  expect(sourceSeen.some(v => typeof v === 'string' && v.length > 0)).toBe(true);

  await page.evaluate(
    async postId => fetch(`/api/posts?postId=${postId}`, { method: 'DELETE' }),
    created.postId
  );
});
