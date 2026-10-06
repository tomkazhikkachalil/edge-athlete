import { test, expect } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';
import { postDraft } from './helpers/drafts';

// The live-round lifecycle product rule, re-pinned for the Drafts round (253,
// Oct 2026): a started round is an ACTIVE IN-PROGRESS SESSION — live presence
// + a way back in from second zero — and its feed post is a DRAFT until the
// creator FINISHES the round and then POSTS it. Two actions: Finish records
// the round; Post publishes it. Nothing on the feed, nothing on any profile
// grid, until Post. The bug this locks out: a round abandoned mid-way used to
// surface on the feed (after six quiet hours) and on the profile (at once).

const stamp = () => Date.now();

test('a started round is live (not a feed post) until it is finished AND posted', { tag: '@smoke' }, async () => {
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  let groupPostId: string | null = null;
  try {
    // Start a round — public so Live Now's public scope carries it; B plays.
    const created = await apiA.post('/api/group-posts', {
      data: {
        type: 'golf_round',
        title: `QA Lifecycle Round ${stamp()}`,
        date: new Date().toISOString().split('T')[0],
        visibility: 'public',
        participant_ids: [userB.id],
        golf_data: {
          course_name: `QA Lifecycle Course ${stamp()}`,
          round_type: 'outdoor',
          holes_played: 9,
        },
      },
    });
    expect(created.ok(), await readErrorBody(created)).toBe(true);
    const body = await created.json();
    groupPostId = body.group_post.id as string;
    const postId = (body.post?.id ?? body.group_post.post_id) as string;

    const feedIds = async (api = apiA) => {
      const feed = await api.get('/api/posts?limit=50');
      expect(feed.ok(), await readErrorBody(feed)).toBe(true);
      return ((await feed.json()).posts as Array<{ id: string }>).map(p => p.id);
    };
    const profileIds = async () => {
      const list = await apiA.get(`/api/posts?userId=${userA.id}&limit=50`);
      expect(list.ok(), await readErrorBody(list)).toBe(true);
      return ((await list.json()).posts as Array<{ id: string }>).map(p => p.id);
    };
    const gridIds = async (tab: 'all' | 'stats') => {
      const res = await apiA.get(`/api/profile/${userA.id}/media?tab=${tab}&limit=50`);
      expect(res.ok(), await readErrorBody(res)).toBe(true);
      return ((await res.json()).items as Array<{ id: string }>).map(i => i.id);
    };

    // 1. ZERO SCORES: the post is a DRAFT — not on the feed, not on the
    //    owner's own profile list or grids…
    const single = await apiA.get(`/api/posts?postId=${postId}`);
    expect(single.ok(), await readErrorBody(single)).toBe(true);
    expect(((await single.json()).post as { status?: string }).status).toBe('draft');
    expect(await feedIds(), 'zero-score round must not be a feed post').not.toContain(postId);
    expect(await profileIds(), 'a draft is not on the owner profile list').not.toContain(postId);
    expect(await gridIds('all'), 'a draft is not an All tile, not even the owner\'s').not.toContain(postId);
    expect(await gridIds('stats'), 'a draft is not a Stats tile').not.toContain(postId);

    // …but the round HAS live presence: Live Now lists it…
    const liveNow = await apiA.get('/api/golf/live-now');
    expect(liveNow.ok(), await readErrorBody(liveNow)).toBe(true);
    expect(JSON.stringify(await liveNow.json())).toContain(groupPostId);

    // …the resume path returns it (the way back in)…
    const resume = await apiA.get('/api/golf/live-round');
    expect(resume.ok(), await readErrorBody(resume)).toBe(true);
    expect((await resume.json()).live_round?.group_post_id).toBe(groupPostId);

    // …and a PLAYING PARTNER can open the draft post (the live page's "View
    // post", the invite bell) while a stranger cannot.
    const asB = await apiB.get(`/api/posts?postId=${postId}`);
    expect(asB.status(), await readErrorBody(asB)).toBe(200);

    // 2. FIRST SCORE (pending → active): still a draft.
    const score = await apiA.post('/api/golf/participant-scores', {
      data: {
        group_post_id: groupPostId,
        participant_scores: [
          { participant_id: userA.id, hole_scores: [{ hole_number: 1, strokes: 5 }] },
        ],
      },
    });
    expect(score.ok(), await readErrorBody(score)).toBe(true);
    expect(await feedIds(), 'in-progress round must not be a feed post').not.toContain(postId);

    // 3. POST before FINISH is refused: Finish comes first.
    const early = await apiA.patch('/api/posts', { data: { postId, action: 'post' } });
    expect(early.status(), await readErrorBody(early)).toBe(409);
    expect((await early.json()).reason).toBe('round_not_finished');

    // 4. FINISH: the round completes — the RECORD is written — and the post
    //    is STILL a draft (nothing is ever auto-posted).
    const end = await apiA.patch(`/api/group-posts/${groupPostId}`, { data: { status: 'completed' } });
    expect(end.ok(), await readErrorBody(end)).toBe(true);
    expect(await feedIds(), 'a finished round is not a feed post until posted').not.toContain(postId);
    expect(await profileIds()).not.toContain(postId);

    // 5. A partner cannot post the creator's draft.
    const notYours = await apiB.patch('/api/posts', { data: { postId, action: 'post' } });
    expect(notYours.status(), await readErrorBody(notYours)).toBe(403);

    // 6. POST: and ONLY NOW it lands in the feed — at the top — and on the
    //    profile; posting twice is refused; Live Now drops it.
    const postedAt = Date.now();
    await postDraft(apiA, postId);
    await expect.poll(async () => feedIds(), { timeout: 15_000 }).toContain(postId);
    // Posting stamps the post's time (the completion-time bump it replaces),
    // so it lands at the top of the feed as of NOW — not the round's start.
    const feedAfter = ((await (await apiA.get('/api/posts?limit=50')).json()).posts as Array<{ id: string; created_at: string }>);
    const posted = feedAfter.find(p => p.id === postId)!;
    expect(Math.abs(Date.parse(posted.created_at) - postedAt)).toBeLessThan(60_000);
    expect(await profileIds()).toContain(postId);
    expect(await gridIds('stats')).toContain(postId);
    const twice = await apiA.patch('/api/posts', { data: { postId, action: 'post' } });
    expect(twice.status(), await readErrorBody(twice)).toBe(409);
    const liveAfter = await apiA.get('/api/golf/live-now');
    if (liveAfter.ok()) expect(JSON.stringify(await liveAfter.json())).not.toContain(groupPostId);
  } finally {
    if (groupPostId) await apiA.delete(`/api/group-posts/${groupPostId}?mode=delete`);
    await apiA.dispose();
    await apiB.dispose();
  }
});
