import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Round 3 (mig 230): the following lens's page comes from feed_following()
// — self + accepted followees, newest first, keyset-paged. Alpha follows
// bravo but not charlie: bravo's and alpha's own posts are on the page,
// charlie's is not; a private post from a followed author IS (the point of
// following); the first keyset page carries nextCursor and the second page
// continues past it without repeating.

test('feed: the following lens is self + accepted followees, private included, keyset-paged', async () => {
  const alpha = loadQaUser('user.json');
  const bravo = loadQaUser('user-b.json');
  const charlie = loadQaUser('user-c.json');
  const alphaApi = await apiAs('state.json');
  const bravoApi = await apiAs('state-b.json');
  const charlieApi = await apiAs('state-c.json');
  const admin = adminClient();
  const created: Array<{ api: typeof alphaApi; id: string }> = [];
  const post = async (api: typeof alphaApi, caption: string, visibility: 'public' | 'private') => {
    const res = await api.post('/api/posts', { data: { caption, visibility } });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    const id = (await res.json()).post.id as string;
    created.push({ api, id });
    return id;
  };
  try {
    await admin.from('follows').upsert({ follower_id: alpha.id, following_id: bravo.id, status: 'accepted' }, { onConflict: 'follower_id,following_id' });
    await admin.from('follows').delete().eq('follower_id', alpha.id).eq('following_id', charlie.id);

    const stamp = Date.now();
    const own = await post(alphaApi, `following-spec own ${stamp}`, 'public');
    const bravoPublic = await post(bravoApi, `following-spec bravo public ${stamp}`, 'public');
    const bravoPrivate = await post(bravoApi, `following-spec bravo private ${stamp}`, 'private');
    const charliePost = await post(charlieApi, `following-spec charlie ${stamp}`, 'public');

    const page1 = await alphaApi.get('/api/posts?scope=following&limit=2&cursor=');
    expect(page1.status(), await readErrorBody(page1)).toBe(200);
    const body1 = await page1.json();
    const ids1 = (body1.posts as Array<{ id: string }>).map(p => p.id);
    expect(ids1).toHaveLength(2);
    expect(body1.nextCursor).toBeTruthy();

    const page2 = await alphaApi.get(`/api/posts?scope=following&limit=20&cursor=${encodeURIComponent(body1.nextCursor)}`);
    expect(page2.status(), await readErrorBody(page2)).toBe(200);
    const ids2 = ((await page2.json()).posts as Array<{ id: string }>).map(p => p.id);
    const all = [...ids1, ...ids2];
    expect(new Set(all).size).toBe(all.length); // no repeats across the cursor
    expect(all).toContain(own);
    expect(all).toContain(bravoPublic);
    expect(all).toContain(bravoPrivate);
    expect(all).not.toContain(charliePost);
  } finally {
    for (const { api, id } of created) await api.delete(`/api/posts?postId=${id}`).catch(() => null);
    // The follow this spec upserted goes too: follow-request.spec (next in
    // the alphabet, the same QA users) starts from "A does not follow B" and
    // met a leftover accepted follow — "Fan" where it clicks "Become a Fan".
    await admin.from('follows').delete().eq('follower_id', alpha.id).eq('following_id', bravo.id);
    await alphaApi.dispose();
    await bravoApi.dispose();
    await charlieApi.dispose();
  }
});
