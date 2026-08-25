import { test, expect, request as playwrightRequest } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import { apiAs, readErrorBody, E2E_BASE_URL } from './helpers/qa-user';

// PR3: group/round media flows through the proxy and is re-authorized as
// public-group || creator || participant (mirrors can_view_group_post).
test('media proxy: group/round media authorized at the byte layer', async () => {
  test.setTimeout(120_000);
  const png = readFileSync(path.join(__dirname, 'fixtures', 'photo.png'));
  const apiA = await apiAs('state.json');   // round creator
  const apiB = await apiAs('state-b.json'); // non-participant
  const createdRounds: string[] = [];
  try {
    const seedRound = async (visibility: 'public' | 'private') => {
      const created = await apiA.post('/api/group-posts', {
        data: {
          type: 'golf_round',
          title: `QA Media Round ${Date.now()}`,
          date: new Date().toISOString().split('T')[0],
          visibility, participant_ids: [],
          golf_data: {
            course_name: `QA Media Course ${Date.now()}`,
            round_type: 'outdoor',
            holes_played: 9,
          },
        },
      });
      expect(created.ok(), await readErrorBody(created)).toBe(true);
      const groupPostId = (await created.json()).group_post.id as string;
      createdRounds.push(groupPostId);

      const up = await apiA.post('/api/upload/post-media', {
        multipart: { file: { name: 'photo.png', mimeType: 'image/png', buffer: png } },
      });
      expect(up.ok(), await readErrorBody(up)).toBe(true);
      const mediaUrl = (await up.json()).url as string;

      const add = await apiA.post(`/api/group-posts/${groupPostId}/media`, {
        data: { media_url: mediaUrl, media_type: 'image', segment_number: 1 },
      });
      expect(add.ok(), await readErrorBody(add)).toBe(true);

      // Read the scorecard (creator) → media must be proxied.
      const card = await apiA.get(`/api/group-posts/${groupPostId}/scorecard`);
      expect(card.ok(), await readErrorBody(card)).toBe(true);
      const scorecard = (await card.json()).scorecard ?? (await card.json());
      const media = scorecard.media as Array<{ media_url: string }>;
      const proxied = media.find(m => m.media_url?.startsWith('/api/media/'))?.media_url;
      expect(proxied, 'round media must be proxied').toBeTruthy();
      return proxied!;
    };

    const base = E2E_BASE_URL;
    const anon = await playwrightRequest.newContext({
      baseURL: base, storageState: { cookies: [], origins: [] },
    });
    try {
      const privProxy = await seedRound('private');
      // Creator gets bytes; non-participant and anon do not.
      const asA = await apiA.get(base + privProxy);
      expect(asA.status(), await readErrorBody(asA)).toBe(200);
      expect((await asA.body()).length).toBeGreaterThan(100);
      expect((await apiB.get(base + privProxy)).status()).toBe(404);
      expect((await anon.get(base + privProxy)).status()).toBe(404);

      const pubProxy = await seedRound('public');
      // Public round media is viewable by anyone, including anonymous.
      expect((await anon.get(base + pubProxy)).status()).toBe(200);
    } finally {
      await anon.dispose();
    }
  } finally {
    for (const id of createdRounds) {
      await apiA.delete(`/api/group-posts/${id}`).catch(() => {});
    }
    await apiA.dispose();
    await apiB.dispose();
  }
});
