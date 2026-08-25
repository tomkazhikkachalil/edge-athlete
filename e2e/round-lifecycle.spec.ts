import { test, expect } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// The live-round lifecycle product rule (dummy-proofing round), pinned for
// the first time: a started round is an ACTIVE IN-PROGRESS SESSION — live
// presence + a way back in from second zero — and becomes a feed post ONLY
// when it completes. The bug this locks out: a zero-score 'pending' round
// used to leak into the feed as an empty post at creation while every
// re-entry surface (banner, Live Now) ignored it.

const stamp = () => Date.now();

test('a started round is live (not a feed post) until it completes', async () => {
  const userA = loadQaUser('user.json');
  const apiA = await apiAs('state.json');
  let groupPostId: string | null = null;
  try {
    // Start a round — public so Live Now's public scope carries it.
    const created = await apiA.post('/api/group-posts', {
      data: {
        type: 'golf_round',
        title: `QA Lifecycle Round ${stamp()}`,
        date: new Date().toISOString().split('T')[0],
        visibility: 'public',
        participant_ids: [],
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

    // 1. ZERO SCORES: the feed listing must NOT contain the round…
    const feed1 = await apiA.get('/api/posts?limit=50');
    expect(feed1.ok(), await readErrorBody(feed1)).toBe(true);
    const feedIds1 = ((await feed1.json()).posts as Array<{ id: string }>).map(p => p.id);
    expect(feedIds1, 'zero-score round must not be a feed post').not.toContain(postId);

    // …but the round HAS live presence: Live Now lists it…
    const liveNow = await apiA.get('/api/golf/live-now');
    expect(liveNow.ok(), await readErrorBody(liveNow)).toBe(true);
    expect(JSON.stringify(await liveNow.json())).toContain(groupPostId);

    // …and the resume banner path returns it (the way back in).
    const resume = await apiA.get('/api/golf/live-round');
    expect(resume.ok(), await readErrorBody(resume)).toBe(true);
    expect((await resume.json()).live_round?.group_post_id).toBe(groupPostId);

    // 2. FIRST SCORE (pending → active): still not a feed post.
    const score = await apiA.post('/api/golf/participant-scores', {
      data: {
        group_post_id: groupPostId,
        participant_scores: [
          { participant_id: userA.id, hole_scores: [{ hole_number: 1, strokes: 5 }] },
        ],
      },
    });
    expect(score.ok(), await readErrorBody(score)).toBe(true);
    const feed2 = await apiA.get('/api/posts?limit=50');
    const feedIds2 = ((await feed2.json()).posts as Array<{ id: string }>).map(p => p.id);
    expect(feedIds2, 'in-progress round must not be a feed post').not.toContain(postId);

    // 3. EXPLICIT END: the round completes and ONLY NOW lands in the feed.
    const end = await apiA.patch(`/api/group-posts/${groupPostId}`, {
      data: { status: 'completed' },
    });
    expect(end.ok(), await readErrorBody(end)).toBe(true);
    await expect
      .poll(
        async () => {
          const feed3 = await apiA.get('/api/posts?limit=50');
          if (!feed3.ok()) return [];
          return ((await feed3.json()).posts as Array<{ id: string }>).map(p => p.id);
        },
        { timeout: 15_000 }
      )
      .toContain(postId);
  } finally {
    if (groupPostId) await apiA.delete(`/api/group-posts/${groupPostId}`);
    await apiA.dispose();
  }
});
