import { test, expect } from './helpers/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// A like follows the read gate, minus blocks (the leftovers program PR 2,
// Oct 28 2026, migration 287 — Tom: "same as reading, minus blocks"): a
// draft, a hidden post, a blocked viewer (either direction) and a departed
// owner's post all answer the 404 a missing post answers; the owner's own
// draft and a published public post answer 200. The route is untouched —
// the function decides. 288 (PR 3) gives the comment like the same gate.
test('like gate: draft / hidden / blocked both ways → 404; the owner\'s own draft and a public post → 200; the comment like follows the post (288)', async () => {
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const bravo = loadQaUser('user-b.json');
  const alphaApi = await apiAs('state.json');
  const bravoApi = await apiAs('state-b.json');
  const stamp = Date.now().toString(36);
  const made: string[] = [];
  const { data: prior } = await admin.from('profiles').select('visibility').eq('id', bravo.id).single();
  try {
    await resetRateBucket(admin, 'like', alpha.id);
    await admin.from('profiles').update({ visibility: 'public' }).eq('id', bravo.id);
    const create = async (api: typeof bravoApi, caption: string) => {
      const res = await api.post('/api/posts', { data: { caption, visibility: 'public', postType: 'general' } });
      expect(res.ok(), await readErrorBody(res)).toBe(true);
      const id = (await res.json()).post.id as string;
      made.push(id);
      return id;
    };
    const publicPost = await create(bravoApi, `Gate public ${stamp}`);
    const draft = await create(bravoApi, `Gate draft ${stamp}`);
    await admin.from('posts').update({ status: 'draft' }).eq('id', draft);
    const hidden = await create(bravoApi, `Gate hidden ${stamp}`);
    await admin.from('posts').update({ status: 'hidden' }).eq('id', hidden);
    const ownDraft = await create(alphaApi, `Gate own draft ${stamp}`);
    await admin.from('posts').update({ status: 'draft' }).eq('id', ownDraft);

    const like = async (postId: string) => alphaApi.post('/api/posts/like', { data: { postId } });
    const notFound = async (postId: string, why: string) => {
      const res = await like(postId);
      expect(res.status(), why).toBe(404);
      expect(await res.json()).toEqual({ error: 'Post not found' });
    };

    await notFound(draft, 'a draft cannot be liked by anyone but its owner');
    await notFound(hidden, 'a post a moderator hid cannot be liked');
    // The owner's own draft: always.
    let res = await like(ownDraft);
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    expect((await res.json()).action).toBe('liked');

    // Blocks, either direction, on a post that is otherwise likeable.
    res = await like(publicPost);
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    expect((await res.json()).likesCount).toBe(1);
    await admin.from('user_blocks').insert({ blocker_id: bravo.id, blocked_id: alpha.id });
    await notFound(publicPost, 'the author blocked the viewer');
    await admin.from('user_blocks').delete().eq('blocker_id', bravo.id).eq('blocked_id', alpha.id);
    await admin.from('user_blocks').insert({ blocker_id: alpha.id, blocked_id: bravo.id });
    await notFound(publicPost, 'the viewer blocked the author');
    await admin.from('user_blocks').delete().eq('blocker_id', alpha.id).eq('blocked_id', bravo.id);
    // Unblocked: the toggle works again (this unlikes — the count returns to 0).
    res = await like(publicPost);
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    expect((await res.json()).likesCount).toBe(0);

    // The comment like follows the parent post's gate (288): a comment on
    // the public post → 200; on the draft → 404; on the public post under a
    // block → 404; a missing comment → 404 (it used to be a 500).
    const comment = async (postId: string) => {
      const r = await bravoApi.post('/api/comments', { data: { postId, content: `Gate comment ${stamp}` } });
      expect(r.ok(), await readErrorBody(r)).toBe(true);
      return ((await r.json()).comment?.id ?? (await admin.from('post_comments').select('id').eq('post_id', postId).order('created_at', { ascending: false }).limit(1).single()).data?.id) as string;
    };
    const publicComment = await comment(publicPost);
    const draftComment = await comment(draft);
    const likeComment = async (commentId: string) => alphaApi.post('/api/comments/like', { data: { commentId } });
    res = await likeComment(publicComment);
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    expect(await res.json()).toMatchObject({ isLiked: true, likes_count: 1 });
    res = await likeComment(draftComment);
    expect(res.status(), 'a comment on a draft cannot be liked').toBe(404);
    expect(await res.json()).toEqual({ error: 'Comment not found' });
    await admin.from('user_blocks').insert({ blocker_id: bravo.id, blocked_id: alpha.id });
    res = await likeComment(publicComment);
    expect(res.status(), 'a block refuses the comment like too').toBe(404);
    await admin.from('user_blocks').delete().eq('blocker_id', bravo.id).eq('blocked_id', alpha.id);
    res = await likeComment('00000000-0000-4000-8000-00000000dead');
    expect(res.status(), 'a missing comment is a 404, not a 500').toBe(404);
    res = await likeComment(publicComment); // unlike, so the run leaves nothing behind
    expect(await res.json()).toMatchObject({ isLiked: false, likes_count: 0 });
  } finally {
    await admin.from('user_blocks').delete().or(`and(blocker_id.eq.${bravo.id},blocked_id.eq.${alpha.id}),and(blocker_id.eq.${alpha.id},blocked_id.eq.${bravo.id})`);
    if (made.length) await admin.from('posts').delete().in('id', made);
    if (prior) await admin.from('profiles').update({ visibility: prior.visibility }).eq('id', bravo.id);
  }
});
