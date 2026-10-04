import { test, expect, request as playwrightRequest } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import { apiAs, loadQaUser, readErrorBody, adminClient, E2E_BASE_URL } from './helpers/qa-user';

// PR1 media proxy: a post's media is served through /api/media/<token>, the
// bytes are re-authorized live, and a private post's media is 404 to anyone
// without access — while a public post's media is 200 to anyone (incl. anon).
test('media proxy: post media authorized at the byte layer', { tag: '@smoke' }, async () => {
  test.setTimeout(120_000);
  const userA = loadQaUser('user.json');
  const png = readFileSync(path.join(__dirname, 'fixtures', 'photo.png'));

  const api = await apiAs('state.json');       // owner (user A)
  let publicPostId = '';
  let privatePostId = '';
  let publicProxy = '';
  let privateProxy = '';
  // QA users seed as PRIVATE; a "public" post by a private profile is NOT
  // publicly viewable (correct rule). Make A public so the public-post case is
  // genuinely public. Restored in finally.
  await adminClient().from('profiles').update({ visibility: 'public' }).eq('id', userA.id);
  try {
    // Upload one image, reuse its URL for a public and a private post.
    const up = await api.post('/api/upload/post-media', {
      multipart: { file: { name: 'photo.png', mimeType: 'image/png', buffer: png } },
    });
    expect(up.ok(), await readErrorBody(up)).toBe(true);
    const mediaUrl = (await up.json()).url as string;
    expect(mediaUrl).toContain('/storage/v1/object/public/uploads/');

    for (const visibility of ['public', 'private'] as const) {
      const res = await api.post('/api/posts', {
        data: {
          postType: 'general', caption: `proxy ${visibility} ${Date.now()}`, visibility,
          media: [{ url: mediaUrl, type: 'image', sortOrder: 0 }],
        },
      });
      expect(res.ok(), await readErrorBody(res)).toBe(true);
      const post = (await res.json()).post;
      // The create response already returns proxied media.
      const proxied = post.media[0].media_url as string;
      expect(proxied, 'create response media must be a proxy path').toMatch(/^\/api\/media\//);
      if (visibility === 'public') { publicPostId = post.id; publicProxy = proxied; }
      else { privatePostId = post.id; privateProxy = proxied; }
      // Confirm the visibility actually persisted as sent.
      const { data: row } = await adminClient().from('posts').select('visibility').eq('id', post.id).single();
      expect(row?.visibility, `post created as ${visibility}`).toBe(visibility);
    }

    const base = E2E_BASE_URL;
    const ownerCtx = await apiAs('state.json');
    const bystanderCtx = await apiAs('state-b.json'); // user B (not a follower)
    // A genuinely cookie-less context — the default `request` fixture inherits
    // the global storageState (user A), so it is NOT anonymous.
    const anonCtx = await playwrightRequest.newContext({
      baseURL: base,
      storageState: 'e2e/.auth/anon.json', // force truly cookie-less
    });
    try {
      // PUBLIC post media: 200 for owner, bystander, AND anonymous.
      const ownerPub = await ownerCtx.get(base + publicProxy);
      expect(ownerPub.status()).toBe(200);
      expect((await bystanderCtx.get(base + publicProxy)).status()).toBe(200);
      expect((await anonCtx.get(base + publicProxy)).status()).toBe(200);
      // Speed round 2: one CDN copy for everyone — public, long-lived, NO Vary.
      expect(ownerPub.headers()['cache-control']).toMatch(/^public, max-age=\d+, s-maxage=\d+, stale-while-revalidate=\d+$/);
      expect(ownerPub.headers()['vary'] ?? '').not.toMatch(/cookie/i);

      // PRIVATE post media: 200 for owner; 404 for bystander and anonymous.
      const ownerPriv = await ownerCtx.get(base + privateProxy);
      expect(ownerPriv.status(), await readErrorBody(ownerPriv)).toBe(200);
      expect((await ownerPriv.body()).length).toBeGreaterThan(100); // real bytes
      // …cached on the viewer's own device for the URL's life, never shared.
      expect(ownerPriv.headers()['cache-control']).toMatch(/^private, max-age=\d+, no-transform$/);
      // A private post's URL EXPIRES (the Instagram model): its token carries exp.
      const privatePayload = JSON.parse(Buffer.from(privateProxy.replace(/^\/api\/media\/(o\/)?/, '').split('.')[0], 'base64url').toString());
      expect(privatePayload.exp).toBeGreaterThan(Date.now() / 1000 + 3600);
      const publicPayload = JSON.parse(Buffer.from(publicProxy.replace(/^\/api\/media\/(o\/)?/, '').split('.')[0], 'base64url').toString());
      expect(publicPayload.exp).toBeUndefined();

      // Speed round 2, C3: a PUBLIC post's URL is the optimizable form and
      // the optimizer can fetch it (it has no cookie); a private post's is
      // not, and the optimizer never sees it (the app never emits it).
      expect(publicProxy).toMatch(/^\/api\/media\/o\//);
      expect(privateProxy).not.toMatch(/^\/api\/media\/o\//);
      const optimized = await anonCtx.get(`${base}/_next/image?url=${encodeURIComponent(publicProxy)}&w=640&q=75`);
      expect(optimized.status(), await readErrorBody(optimized)).toBe(200);
      expect(optimized.headers()['content-type']).toMatch(/^image\//);
      const refused = await anonCtx.get(`${base}/_next/image?url=${encodeURIComponent(privateProxy)}&w=640&q=75`);
      expect([400, 404, 500]).toContain(refused.status()); // never bytes
      expect((await bystanderCtx.get(base + privateProxy)).status()).toBe(404);
      expect((await anonCtx.get(base + privateProxy)).status()).toBe(404);

      // Forged/garbage token → 404, never a 500 or a leak.
      expect((await anonCtx.get(base + '/api/media/garbage.token')).status()).toBe(404);
    } finally {
      await ownerCtx.dispose();
      await bystanderCtx.dispose();
      await anonCtx.dispose();
    }
  } finally {
    if (publicPostId) await api.delete(`/api/posts/${publicPostId}`).catch(() => {});
    if (privatePostId) await api.delete(`/api/posts/${privatePostId}`).catch(() => {});
    await adminClient().from('profiles').update({ visibility: 'private' }).eq('id', userA.id);
    await api.dispose();
  }
});
