import { test, expect } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

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
    await page.getByRole('button', { name: 'Delete Round', exact: true }).click();

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
