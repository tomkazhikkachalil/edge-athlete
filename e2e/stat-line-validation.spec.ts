import { test, expect } from '@playwright/test';
import { apiAs, readErrorBody } from './helpers/qa-user';

// Data foundation F2 (Sep 13 2026): a post's stat line is validated on the
// SERVER against the sport's schema. Tom's decision: reject with a 400 that
// names the field — never clamp, never strip. The composer already validates,
// so only a hand-made POST (this spec) ever meets the 400. A non-stat-line
// payload (`{score: 42}`, what tagged.spec seeds) still passes: the validator
// has an opinion only about `type: 'stat_line'`.
test('stat line: the posts route rejects an unknown stat / a range miss with a 400 and stores a valid line', async () => {
  const api = await apiAs('state.json');
  const stamp = Date.now();
  const line = (stats: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
    caption: `Hockey night ${stamp}`,
    visibility: 'public',
    postType: 'ice_hockey',
    stats_data: { type: 'stat_line', sport_key: 'ice_hockey', date: '2026-09-10', opponent: 'Wolves', result: 'W', stats, ...over },
  });
  let postId = '';
  try {
    const unknown = await api.post('/api/posts', { data: line({ goals: 1, nope: 1 }) });
    expect(unknown.status()).toBe(400);
    expect(await readErrorBody(unknown)).toMatch(/Unknown stat \\?"nope\\?" for this sport/);

    const range = await api.post('/api/posts', { data: line({ goals: 99 }) });
    expect(range.status()).toBe(400);
    expect(await readErrorBody(range)).toContain('Goals is out of range');

    const future = await api.post('/api/posts', { data: line({ goals: 1 }, { date: '2999-01-01' }) });
    expect(future.status()).toBe(400);
    expect(await readErrorBody(future)).toContain('future');

    const wrongSport = await api.post('/api/posts', { data: { ...line({ goals: 1 }), postType: 'volleyball' } });
    expect(wrongSport.status()).toBe(400);

    // A valid line is stored exactly as sent.
    const ok = await api.post('/api/posts', { data: line({ goals: 2, assists: 1 }) });
    expect(ok.ok(), await readErrorBody(ok)).toBe(true);
    const post = (await ok.json()).post;
    postId = post.id;
    expect(post.stats_data).toMatchObject({ type: 'stat_line', sport_key: 'ice_hockey', stats: { goals: 2, assists: 1 } });

    // A plain blob on a non-golf post is not a stat line — untouched (tagged.spec relies on it).
    const blob = await api.post('/api/posts', { data: { caption: `Blob ${stamp}`, visibility: 'public', postType: 'ice_hockey', stats_data: { score: 42 } } });
    expect(blob.ok(), await readErrorBody(blob)).toBe(true);
    const blobId = (await blob.json()).post.id as string;
    await api.delete(`/api/posts?postId=${blobId}`);
  } finally {
    if (postId) await api.delete(`/api/posts?postId=${postId}`).catch(() => {});
    await api.dispose();
  }
});
