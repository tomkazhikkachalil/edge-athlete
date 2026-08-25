import { test, expect, request as playwrightRequest } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import { apiAs, loadQaUser, readErrorBody, E2E_BASE_URL } from './helpers/qa-user';

// PR2: message media is served through the proxy and re-authorized as
// conversation-participant-only — 404 to a non-participant and to anon,
// even though the bucket is still public.
test('media proxy: message media is participant-scoped at the byte layer', async () => {
  test.setTimeout(120_000);
  const userB = loadQaUser('user-b.json');
  const png = readFileSync(path.join(__dirname, 'fixtures', 'photo.png'));

  const apiA = await apiAs('state.json');   // sender + participant
  const apiB = await apiAs('state-b.json'); // recipient + participant
  let proxied = '';
  try {
    // A → B direct conversation.
    const conv = await apiA.post('/api/messages', {
      data: { type: 'direct', participantId: userB.id },
    });
    expect(conv.ok(), await readErrorBody(conv)).toBe(true);
    const conversationId = (await conv.json()).conversationId as string;

    // A uploads an image and sends it into the conversation.
    const up = await apiA.post('/api/upload/post-media', {
      multipart: { file: { name: 'photo.png', mimeType: 'image/png', buffer: png } },
    });
    expect(up.ok(), await readErrorBody(up)).toBe(true);
    const mediaUrl = (await up.json()).url as string;

    const send = await apiA.post(`/api/messages/${conversationId}/messages`, {
      data: { type: 'image', media_url: mediaUrl, media_type: 'image' },
    });
    expect(send.ok(), await readErrorBody(send)).toBe(true);
    // The send response already returns a proxied media_url.
    proxied = (await send.json()).message.media_url as string;
    expect(proxied).toMatch(/^\/api\/media\//);

    // The GET list also proxies it.
    const list = await apiA.get(`/api/messages/${conversationId}?limit=10`);
    expect(list.ok(), await readErrorBody(list)).toBe(true);
    const listed = (await list.json()).messages.find((m: { media_url: string | null }) => m.media_url);
    expect(listed.media_url).toMatch(/^\/api\/media\//);

    const base = E2E_BASE_URL;
    const anon = await playwrightRequest.newContext({
      baseURL: base,
      storageState: { cookies: [], origins: [] },
    });
    try {
      // Both participants get the bytes; a non-participant (anon) does not.
      const asA = await apiA.get(base + proxied);
      expect(asA.status(), await readErrorBody(asA)).toBe(200);
      expect((await asA.body()).length).toBeGreaterThan(100);
      expect((await apiB.get(base + proxied)).status()).toBe(200);
      expect((await anon.get(base + proxied)).status()).toBe(404);
    } finally {
      await anon.dispose();
    }
  } finally {
    await apiA.dispose();
    await apiB.dispose();
  }
});
