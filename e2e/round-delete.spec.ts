import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { purgePost } from './helpers/results';
import { cardRowFor, readScorecard, scoreHoles } from './helpers/sport-events';

// Round deletion (Aug 19): a creator can delete a round WITHOUT posting it —
// from the live surface while the round is live, and via the post trash once
// it's completed. Both paths run the same server cascade (group post +
// children + feed post + golf_rounds mirrors), so a deleted round leaves
// nothing behind: no /live page, no Live Now entry, no feed post, no stats.

const stamp = () => Date.now();

async function createRound(
  api: Awaited<ReturnType<typeof apiAs>>,
  opts: { alreadyPlayed?: boolean; participantIds?: string[] } = {}
) {
  const res = await api.post('/api/group-posts', {
    data: {
      type: 'golf_round',
      title: `QA Delete Round ${stamp()}`,
      date: new Date().toISOString().split('T')[0],
      visibility: 'private',
      participant_ids: opts.participantIds ?? [],
      already_played: opts.alreadyPlayed || undefined,
      golf_data: {
        course_name: `QA Delete Course ${stamp()}`,
        round_type: 'outdoor',
        holes_played: 9,
      },
    },
  });
  expect(res.ok(), await readErrorBody(res)).toBe(true);
  const body = await res.json();
  return {
    groupPostId: body.group_post.id as string,
    postId: (body.post?.id ?? body.group_post.post_id ?? null) as string | null,
  };
}

test('live round: creator deletes from /live without ever posting', async ({ page }) => {
  const apiA = await apiAs('state.json');
  let groupPostId: string;
  try {
    ({ groupPostId } = await createRound(apiA));

    await page.goto(`/live/${groupPostId}`);
    // The scorer auto-opens for a scoreable round — close it to reach the card.
    await page.getByRole('button', { name: 'Close', exact: true }).first().click();

    await page.getByRole('button', { name: 'Delete round' }).click();
    await expect(page.getByText('Delete this round?')).toBeVisible();
    await page.getByRole('button', { name: 'Delete Round', exact: true }).click();

    // Deleting navigates to the feed…
    await page.waitForURL('**/feed');

    // …and the round is GONE server-side: scorecard 404s, Live Now is clean.
    const gone = await apiA.get(`/api/group-posts/${groupPostId}`);
    expect(gone.status()).toBe(404);
    const liveNow = await apiA.get('/api/golf/live-now');
    if (liveNow.ok()) {
      const list = JSON.stringify(await liveNow.json());
      expect(list).not.toContain(groupPostId);
    }
  } finally {
    await apiA.dispose();
  }
});

test('completed round: deleting the feed post deletes the round underneath', async ({ page }) => {
  const apiA = await apiAs('state.json');
  try {
    const { groupPostId, postId } = await createRound(apiA, { alreadyPlayed: true });
    expect(postId).toBeTruthy();

    await page.goto(`/feed?post=${postId}`);
    // The deep-link modal's trash — the exact mount that used to be a dead
    // button (no onDelete). Round-aware confirm copy proves the wiring.
    // Scoped to the overlay: the same post also renders in the feed list
    // behind the modal, and both trashes are (correctly) wired now.
    await page
      .locator('div.fixed.inset-0')
      .getByRole('button', { name: 'Delete post' })
      .first()
      .click();
    await expect(page.getByText('Delete this round?')).toBeVisible();
    // The server's own answer, not only the state after it: this case failed
    // once in a long batch (the round still there after 15 s) and passed
    // every other time — if it ever recurs, this line says what was answered.
    const answered = page.waitForResponse(r => r.url().includes(`/api/posts?postId=${postId}`) && r.request().method() === 'DELETE', { timeout: 45_000 });
    await page.getByRole('button', { name: 'Delete Round', exact: true }).click();
    const res = await answered;
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()).hidden, 'an unscored round deletes — it is not hidden').toBeUndefined();

    // Round AND post both gone.
    await expect
      .poll(async () => (await apiA.get(`/api/group-posts/${groupPostId}`)).status(), {
        timeout: 15_000,
      })
      .toBe(404);
    const post = await apiA.get(`/api/posts?postId=${postId}`);
    // The posts GET is a listing route; assert through the group post above
    // and the round page below instead of a post-shaped 404.
    void post;
    await page.goto(`/live/${groupPostId}`);
    await expect(page.getByText("This round isn't available")).toBeVisible();
  } finally {
    await apiA.dispose();
  }
});

test('a participant cannot delete the round — 403, round survives', async ({ browser }) => {
  const userB = loadQaUser('user-b.json');
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  let groupPostId: string;
  try {
    ({ groupPostId } = await createRound(apiA, { participantIds: [userB.id] }));

    // B (a participant, not the creator) tries the DELETE directly.
    const res = await apiB.delete(`/api/group-posts/${groupPostId}`);
    expect(res.status()).toBe(403);

    // The round is untouched — this is what the old handler got wrong (its
    // 0-row RLS-refused delete reported success while deleting nothing).
    const still = await apiA.get(`/api/group-posts/${groupPostId}`);
    expect(still.ok(), await readErrorBody(still)).toBe(true);

    // Creator cleans up through the real path.
    const del = await apiA.delete(`/api/group-posts/${groupPostId}`);
    expect(del.ok(), await readErrorBody(del)).toBe(true);
  } finally {
    await apiA.dispose();
    await apiB.dispose();
    void browser;
  }
});

// ── Quick fixes, PR 2 (Oct 2026): Delete, for real ──────────────────────────
// Tom amended the Sep 26 "hide only" rule: a round that is NOT from a
// tournament, a club or a league may be deleted by its player — and a round
// that is still being played can always be discarded ("the only way to close
// a round is by pressing End Round"). Hide stays beside Delete; an official
// result can only be hidden; in a shared round a delete removes YOUR result.

const nineHoles = (strokes: number) => Array.from({ length: 9 }, (_, i) => ({ hole_number: i + 1, strokes }));

/** Create a casual round, score it, and (optionally) end it. Returns its ids. */
async function playedRound(
  api: Awaited<ReturnType<typeof apiAs>>,
  ownerId: string,
  opts: { participantIds?: string[]; complete?: boolean; holes?: number; visibility?: 'public' | 'private' } = {}
) {
  const made = await api.post('/api/group-posts', {
    data: {
      type: 'golf_round',
      title: `QA Delete Round ${stamp()}`,
      date: new Date().toISOString().split('T')[0],
      visibility: opts.visibility ?? 'private',
      participant_ids: opts.participantIds ?? [],
      golf_data: { course_name: `QA Delete Course ${stamp()}`, round_type: 'outdoor', holes_played: 9 },
    },
  });
  expect(made.ok(), await readErrorBody(made)).toBe(true);
  const body = await made.json();
  const groupPostId = body.group_post.id as string;
  const course = body.group_post.golf_data?.course_name as string | undefined;
  const card = await readScorecard(api, groupPostId);
  await scoreHoles(api, cardRowFor(card, ownerId), opts.holes ? nineHoles(5).slice(0, opts.holes) : nineHoles(5));
  if (opts.complete) {
    const done = await api.patch(`/api/group-posts/${groupPostId}`, { data: { status: 'completed' } });
    expect(done.ok(), await readErrorBody(done)).toBe(true);
  }
  const postId = ((await adminClient().from('group_posts').select('post_id').eq('id', groupPostId).single()).data?.post_id as string | null) ?? null;
  return { groupPostId, postId, card, course };
}

const mirrorsOf = async (groupPostId: string) =>
  ((await adminClient().from('golf_rounds').select('id, profile_id').eq('group_post_id', groupPostId)).data ?? []) as Array<{ id: string; profile_id: string }>;

test('a SCORED live round is discarded by Delete — not hidden and left running', async ({ page }) => {
  test.setTimeout(120_000);
  const alpha = loadQaUser('user.json');
  const apiA = await apiAs('state.json');
  let groupPostId = '';
  try {
    ({ groupPostId } = await playedRound(apiA, alpha.id, { holes: 3 }));
    expect((await readScorecard(apiA, groupPostId)).group_post.status).not.toBe('completed');

    await page.goto(`/live/${groupPostId}`);
    await page.getByRole('button', { name: 'Close', exact: true }).first().click();
    await page.getByRole('button', { name: 'Delete round' }).click();
    // Scored, so it says what is lost — and it is a delete, not a hide.
    await expect(page.getByText('Delete this round?')).toBeVisible();
    await expect(page.getByText(/every score entered so far (is|are) deleted/)).toBeVisible();
    await page.getByRole('button', { name: 'Delete Round', exact: true }).click();
    await page.waitForURL('**/feed');

    // Gone: no round, not in Live Now, nothing recorded.
    await expect.poll(async () => (await apiA.get(`/api/group-posts/${groupPostId}`)).status(), { timeout: 15_000 }).toBe(404);
    const liveNow = await apiA.get('/api/golf/live-now');
    if (liveNow.ok()) expect(JSON.stringify(await liveNow.json())).not.toContain(groupPostId);
    expect(await mirrorsOf(groupPostId)).toHaveLength(0);
    groupPostId = '';
  } finally {
    if (groupPostId) await adminClient().from('group_posts').delete().eq('id', groupPostId);
    await apiA.dispose();
  }
});

test('a live round can be deleted from its CARD, not only from /live', async ({ page }) => {
  test.setTimeout(120_000);
  const alpha = loadQaUser('user.json');
  const apiA = await apiAs('state.json');
  let groupPostId = '';
  try {
    const made = await playedRound(apiA, alpha.id, { holes: 2 });
    groupPostId = made.groupPostId;
    test.skip(!made.postId, 'this round has no feed post while it is live');
    // The card used to offer End Round only — which RECORDS the round.
    await page.goto(`/feed?post=${made.postId}`);
    const popup = page.locator('[data-post-detail]');
    await expect(popup.locator('[data-testid="post-card"]')).toBeVisible({ timeout: 20_000 });
    await popup.getByRole('button', { name: 'Delete round' }).click();
    await expect(page.getByText('Delete this round?')).toBeVisible();
    await page.getByRole('button', { name: 'Delete Round', exact: true }).click();
    await expect(popup).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(async () => (await apiA.get(`/api/group-posts/${groupPostId}`)).status(), { timeout: 15_000 }).toBe(404);
    groupPostId = '';
  } finally {
    if (groupPostId) await adminClient().from('group_posts').delete().eq('id', groupPostId);
    await apiA.dispose();
  }
});

async function deleteFinishedForGood(browser: import('@playwright/test').Browser, viewport: { width: number; height: number }) {
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const apiA = await apiAs('state.json');
  await resetRateBucket(admin, 'post-create', alpha.id);
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport });
  let groupPostId = '';
  let postId: string | null = null;
  try {
    const made = await playedRound(apiA, alpha.id, { complete: true, visibility: 'public' });
    groupPostId = made.groupPostId;
    postId = made.postId;
    expect(postId).toBeTruthy();
    await expect.poll(async () => (await mirrorsOf(groupPostId)).length).toBe(1);
    const mirrorId = (await mirrorsOf(groupPostId))[0].id;
    await expect.poll(async () => (await admin.from('athlete_performances').select('id').eq('natural_key', `golf_round:${mirrorId}`)).data?.length ?? 0).toBe(1);

    const page = await ctx.newPage();
    await page.goto(`/feed?post=${postId}`);
    const popup = page.locator('[data-post-detail]');
    await expect(popup.locator('[data-testid="post-card"]')).toBeVisible({ timeout: 20_000 });
    // BOTH doors are offered on a finished for-fun round.
    const menu = popup.getByRole('button', { name: 'Post options' });
    if (viewport.width < 640) {
      await menu.click();
      await expect(page.locator('[data-menu-item="delete"]')).toHaveText(/Hide from profile/);
      await page.locator('[data-menu-item="delete-for-good"]').click();
    } else {
      await expect(popup.locator('[data-post-delete="hide"]')).toBeVisible();
      await popup.locator('[data-post-delete="for-good"]').click();
    }
    await expect(page.getByText('Delete it for good?')).toBeVisible();
    await expect(page.getByText(/stops counting toward your handicap and stats/)).toBeVisible();
    const answered = page.waitForResponse(r => r.url().includes(`/api/posts?postId=${postId}`) && r.request().method() === 'DELETE');
    // The confirm's own button — the card's icon carries the same name.
    await page.getByRole('dialog', { name: 'Delete it for good?' }).getByRole('button', { name: 'Delete for good', exact: true }).click();
    const res = await answered;
    expect(res.status()).toBe(200);
    expect((await res.json()).deleted).toBe(true);

    // Gone for good: the post, the round, the stats row and the dataset row.
    expect((await admin.from('posts').select('id').eq('id', postId!)).data).toHaveLength(0);
    expect((await admin.from('group_posts').select('id').eq('id', groupPostId)).data).toHaveLength(0);
    expect(await mirrorsOf(groupPostId)).toHaveLength(0);
    expect((await admin.from('athlete_performances').select('id').eq('natural_key', `golf_round:${mirrorId}`)).data).toHaveLength(0);
    groupPostId = '';
    postId = null;
  } finally {
    await ctx.close().catch(() => null);
    if (postId) await purgePost(postId);
    if (groupPostId) {
      await admin.from('golf_rounds').delete().eq('group_post_id', groupPostId);
      await admin.from('group_posts').delete().eq('id', groupPostId);
    }
    await apiA.dispose();
  }
}

test('a finished for-fun round offers Hide AND Delete; Delete removes it for good', async ({ browser }) => {
  test.setTimeout(150_000);
  await deleteFinishedForGood(browser, { width: 1280, height: 800 });
});

test('a finished for-fun round is deleted for good from the phone menu @mobile', async ({ browser }) => {
  test.setTimeout(150_000);
  await deleteFinishedForGood(browser, { width: 390, height: 844 });
});

test('in a shared round a delete removes YOUR result only; an official result is refused; a bare DELETE still hides', async () => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const bravo = loadQaUser('user-b.json');
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  await resetRateBucket(admin, 'post-create', alpha.id);
  let groupPostId = '';
  let postId: string | null = null;
  let lineId = '';
  try {
    // Alpha and bravo both play; alpha ends the round.
    const made = await playedRound(apiA, alpha.id, { participantIds: [bravo.id] });
    groupPostId = made.groupPostId;
    postId = made.postId;
    await scoreHoles(apiB, cardRowFor(await readScorecard(apiB, groupPostId), bravo.id), nineHoles(6));
    const done = await apiA.patch(`/api/group-posts/${groupPostId}`, { data: { status: 'completed' } });
    expect(done.ok(), await readErrorBody(done)).toBe(true);
    await expect.poll(async () => (await mirrorsOf(groupPostId)).length).toBe(2);
    postId = ((await admin.from('group_posts').select('post_id').eq('id', groupPostId).single()).data?.post_id as string | null) ?? postId;

    // An old tab's bare DELETE never destroys: it hides (the Sep 26 answer).
    let res = await apiA.delete(`/api/posts?postId=${postId}`);
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    expect((await res.json()).hidden).toBe(true);
    expect(await mirrorsOf(groupPostId)).toHaveLength(2);

    // The creator deletes for good: their result and the post; bravo keeps theirs.
    res = await apiA.delete(`/api/posts?postId=${postId}&mode=delete`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await res.json()).deleted).toBe(true);
    const left = await mirrorsOf(groupPostId);
    expect(left.map(m => m.profile_id)).toEqual([bravo.id]);
    expect((await admin.from('posts').select('id').eq('id', postId!)).data).toHaveLength(0);
    postId = null;
    expect((await admin.from('group_posts').select('id').eq('id', groupPostId)).data).toHaveLength(1);
    const cardAfter = await readScorecard(apiB, groupPostId);
    const scoresOf = (id: string) => cardAfter.participants.find(p => p.participant.profile_id === id)?.scores?.hole_scores?.length ?? 0;
    expect(scoresOf(bravo.id)).toBe(9);
    expect(scoresOf(alpha.id)).toBe(0);

    // Bravo (a partner) deletes their own from the round page's door.
    res = await apiB.delete(`/api/golf/rounds/${left[0].id}?mode=delete`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(await mirrorsOf(groupPostId)).toHaveLength(0);
    // …and alpha could not have deleted bravo's.
    res = await apiA.delete(`/api/golf/rounds/${left[0].id}?mode=delete`);
    expect([403, 404]).toContain(res.status());

    // An OFFICIAL result: delete refused in plain words, hide still allowed.
    res = await apiA.post('/api/posts', {
      data: { caption: `Official line ${stamp()}`, visibility: 'public', postType: 'ice_hockey', stats_data: { type: 'stat_line', sport_key: 'ice_hockey', date: '2026-09-20', opponent: 'Wolves', result: 'W', stats: { goals: 1, assists: 1 } } },
    });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    lineId = (await res.json()).post.id as string;
    await expect.poll(async () => (await admin.from('athlete_performances').select('id').eq('natural_key', `post:${lineId}`)).data?.length ?? 0).toBe(1);
    const stamped = await admin.from('athlete_performances').update({ provenance: 'club_recorded' }).eq('natural_key', `post:${lineId}`);
    expect(stamped.error).toBeNull();
    res = await apiA.delete(`/api/posts?postId=${lineId}&mode=delete`);
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toMatch(/official result/);
    expect((await admin.from('posts').select('status').eq('id', lineId).single()).data?.status).toBe('published');
    res = await apiA.delete(`/api/posts?postId=${lineId}`);
    expect((await res.json()).hidden).toBe(true);

    // A self-entered line (not official) deletes for good, dataset row and all.
    await admin.from('athlete_performances').update({ provenance: 'self_reported' }).eq('natural_key', `post:${lineId}`);
    res = await apiA.delete(`/api/posts?postId=${lineId}&mode=delete`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await admin.from('posts').select('id').eq('id', lineId)).data).toHaveLength(0);
    expect((await admin.from('athlete_performances').select('id').eq('natural_key', `post:${lineId}`)).data).toHaveLength(0);
    lineId = '';
  } finally {
    if (lineId) await purgePost(lineId);
    if (postId) await purgePost(postId);
    if (groupPostId) {
      await admin.from('golf_rounds').delete().eq('group_post_id', groupPostId);
      await admin.from('group_posts').delete().eq('id', groupPostId);
    }
    await apiA.dispose();
    await apiB.dispose();
  }
});
