import { test, expect, request as playwrightRequest } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import { apiAs, loadQaUser, readErrorBody, adminClient, E2E_BASE_URL } from './helpers/qa-user';

// PR4: equipment images (profile-scoped) go through the proxy — public
// profile's equipment is anon-viewable; a private profile's is not.
test('media proxy: equipment media is profile-scoped at the byte layer', async () => {
  test.setTimeout(120_000);
  const userA = loadQaUser('user.json');
  const png = readFileSync(path.join(__dirname, 'fixtures', 'photo.png'));
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  let equipmentId = '';
  try {
    const up = await apiA.post('/api/upload/post-media', {
      multipart: { file: { name: 'photo.png', mimeType: 'image/png', buffer: png } },
    });
    expect(up.ok(), await readErrorBody(up)).toBe(true);
    const imageUrl = (await up.json()).url as string;

    const add = await apiA.post('/api/equipment', {
      data: { profileId: userA.id, category: 'driver', brand: 'QA', model: `M${Date.now()}`, sportKey: 'golf', imageUrl },
    });
    expect(add.ok(), await readErrorBody(add)).toBe(true);
    equipmentId = (await add.json()).equipment?.id ?? '';

    const readProxied = async (ctx: typeof apiA) => {
      const res = await ctx.get(`/api/equipment?profileId=${userA.id}`);
      expect(res.ok(), await readErrorBody(res)).toBe(true);
      const item = (await res.json()).equipment.find((e: { image_url: string | null }) => e.image_url);
      return item?.image_url as string;
    };

    const base = E2E_BASE_URL;
    const anon = await playwrightRequest.newContext({ baseURL: base, storageState: { cookies: [], origins: [] } });
    try {
      // Owner is private by default → owner sees proxied bytes, anon 404.
      const proxied = await readProxied(apiA);
      expect(proxied).toMatch(/^\/api\/media\//);
      expect((await apiA.get(base + proxied)).status()).toBe(200);
      expect((await anon.get(base + proxied)).status()).toBe(404);

      // Make A public → the same equipment image is now anon-viewable.
      await adminClient().from('profiles').update({ visibility: 'public' }).eq('id', userA.id);
      expect((await anon.get(base + proxied)).status()).toBe(200);
    } finally {
      await anon.dispose();
      await adminClient().from('profiles').update({ visibility: 'private' }).eq('id', userA.id);
    }
  } finally {
    if (equipmentId) await apiA.delete(`/api/equipment/${equipmentId}`).catch(() => {});
    await apiA.dispose();
    await apiB.dispose();
  }
});
