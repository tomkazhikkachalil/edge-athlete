import { test, expect } from '@playwright/test';
import { apiAs, adminClient, loadQaUser, readErrorBody } from './helpers/qa-user';

// One post by its id (`GET /api/posts/[id]`) follows the feed's rule
// (Oct 9 2026, `src/lib/posts/read-gate.ts`): a followers-only post — the
// pre-Oct 9 per-post "private" — and a public post on a PRIVATE account reach
// approved fans only; a public post on a public account reaches anyone; a
// draft reaches nobody but its owner. The route used to admit any signed-in
// viewer to a private post on a public account, and anyone to the rest.

test('one post by its link: fans-only stays with fans; drafts stay with the owner', async () => {
  test.setTimeout(90_000);
  const admin = adminClient();
  const a = loadQaUser('user.json');
  const b = loadQaUser('user-b.json');
  const owner = await apiAs('state.json');
  const stranger = await apiAs('state-b.json');
  const { data: before } = await admin.from('profiles').select('visibility').eq('id', a.id).single();
  const created: string[] = [];

  const post = async (visibility: 'public' | 'private') => {
    const res = await owner.post('/api/posts', { data: { postType: 'general', caption: `read gate ${visibility} ${Date.now()}`, visibility } });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    const id = (await res.json()).post.id as string;
    created.push(id);
    return id;
  };
  const status = async (id: string) => (await stranger.get(`/api/posts/${id}`)).status();

  try {
    await admin.from('follows').delete().eq('follower_id', b.id).eq('following_id', a.id);
    await admin.from('profiles').update({ visibility: 'public' }).eq('id', a.id);

    const open = await post('public');
    const fansOnly = await post('private');
    expect(await status(open), 'a public post on a public account: anyone').toBe(200);
    expect(await status(fansOnly), 'a followers-only post: not a stranger, even signed in').toBe(404);
    expect((await owner.get(`/api/posts/${fansOnly}`)).status(), 'the owner always').toBe(200);

    // A draft: never anyone but the owner — not a fan either.
    await admin.from('posts').update({ status: 'draft' }).eq('id', open);
    expect(await status(open), 'a draft: not a stranger').toBe(404);
    await admin.from('posts').update({ status: 'published' }).eq('id', open);

    // A PRIVATE account: its public post reaches fans only.
    await admin.from('profiles').update({ visibility: 'private' }).eq('id', a.id);
    expect(await status(open), 'a public post on a private account: not a stranger').toBe(404);

    // B becomes an approved fan: both posts open.
    await admin.from('follows').upsert({ follower_id: b.id, following_id: a.id, status: 'accepted' }, { onConflict: 'follower_id,following_id' });
    expect(await status(open), 'a fan: the private account’s post').toBe(200);
    expect(await status(fansOnly), 'a fan: the followers-only post').toBe(200);
  } finally {
    for (const id of created) await owner.delete(`/api/posts?postId=${id}`).catch(() => {});
    await admin.from('follows').delete().eq('follower_id', b.id).eq('following_id', a.id);
    await admin.from('profiles').update({ visibility: before?.visibility ?? 'private' }).eq('id', a.id);
    await owner.dispose();
    await stranger.dispose();
  }
});
