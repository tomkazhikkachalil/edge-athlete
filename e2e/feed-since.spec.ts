import { test, expect } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Round 3: the feed's "anything new since the top of my list?" poll —
// `GET /api/posts?since=<created_at>` answers posts strictly newer than the
// timestamp, newest first, in the feed's shape, with the server's privacy
// gating (it replaced a platform-wide realtime subscription). Bravo posts;
// alpha asks since a moment before; the post is there, an older one is
// not; a bad `since` and `since` with a cursor are 400s.

test('feed: ?since= answers only posts newer than the timestamp, in the feed shape', async () => {
  const bravo = loadQaUser('user-b.json');
  const alphaApi = await apiAs('state.json');
  const bravoApi = await apiAs('state-b.json');
  const createdIds: string[] = [];
  try {
    // Alpha follows bravo (public QA users accept in one act; a pending row is fine for the "all" lens anyway).
    await alphaApi.post('/api/follow', { data: { followingId: bravo.id } });
    const older = await bravoApi.post('/api/posts', { data: { caption: `since-spec older ${Date.now()}`, visibility: 'public' } });
    expect(older.ok(), await readErrorBody(older)).toBe(true);
    createdIds.push((await older.json()).post.id);
    await new Promise(r => setTimeout(r, 1200));
    const since = new Date().toISOString();
    await new Promise(r => setTimeout(r, 1200));
    const newer = await bravoApi.post('/api/posts', { data: { caption: `since-spec newer ${Date.now()}`, visibility: 'public' } });
    expect(newer.ok(), await readErrorBody(newer)).toBe(true);
    const newerId = (await newer.json()).post.id as string;
    createdIds.push(newerId);

    const res = await alphaApi.get(`/api/posts?limit=10&since=${encodeURIComponent(since)}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const ids = ((await res.json()).posts as Array<{ id: string; created_at: string }>).map(p => p.id);
    expect(ids).toContain(newerId);
    expect(ids).not.toContain(createdIds[0]);

    expect((await alphaApi.get('/api/posts?limit=10&since=not-a-date')).status()).toBe(400);
    expect((await alphaApi.get(`/api/posts?limit=10&since=${encodeURIComponent(since)}&cursor=`)).status()).toBe(400);
  } finally {
    for (const id of createdIds) if (id) await bravoApi.delete(`/api/posts?postId=${id}`).catch(() => null);
    await alphaApi.dispose();
    await bravoApi.dispose();
  }
});
