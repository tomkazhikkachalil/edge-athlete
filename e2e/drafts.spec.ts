import { test, expect } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';
import { cardRowFor, readScorecard, scoreHoles } from './helpers/sport-events';

// Drafts round PR 2 (Oct 2026): the private Drafts area and the review
// screen. A round in progress is listed with Resume / Finish / Discard (the
// creator) or Resume alone (a partner); Finish lands on the review screen;
// notes are saved as you type and Keep as draft keeps them; the draft is off
// the owner's own profile grid; Post puts it on the feed and empties Drafts.

const stamp = () => Date.now();

async function startRound(api: Awaited<ReturnType<typeof apiAs>>, course: string, participantIds: string[] = []) {
  const res = await api.post('/api/group-posts', {
    data: { type: 'golf_round', title: `QA Drafts ${stamp()}`, date: new Date().toISOString().split('T')[0], visibility: 'public', participant_ids: participantIds, golf_data: { course_name: course, round_type: 'outdoor', holes_played: 9 } },
  });
  expect(res.ok(), await readErrorBody(res)).toBe(true);
  const body = await res.json();
  return { groupPostId: body.group_post.id as string, postId: body.group_post.post_id as string };
}

test('drafts: in progress → Finish → review → Keep as draft → Post', { tag: '@mobile' }, async ({ page, browser }) => {
  test.setTimeout(150_000);
  const alpha = loadQaUser('user.json');
  const bravo = loadQaUser('user-b.json');
  const apiA = await apiAs('state.json');
  let groupPostId = '';
  try {
    const course = `QA Drafts Course ${stamp()}`;
    const made = await startRound(apiA, course, [bravo.id]);
    groupPostId = made.groupPostId;
    const card = await readScorecard(apiA, groupPostId);
    await scoreHoles(apiA, cardRowFor(card, alpha.id), [{ hole_number: 1, strokes: 4 }, { hole_number: 2, strokes: 5 }]);

    // The creator's Drafts: the round is in progress, with all three doors.
    await page.goto('/athlete/drafts');
    const row = page.locator(`[data-draft-row="round:${groupPostId}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toHaveAttribute('data-draft-state', 'in_progress');
    await expect(row.locator('[data-draft-resume]')).toBeVisible();
    await expect(row.locator('[data-draft-finish]')).toBeVisible();
    await expect(row.locator('[data-draft-discard]')).toBeVisible();

    // A partner's Drafts: in progress, Resume only — the draft is the creator's.
    const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const pageB = await ctxB.newPage();
      await pageB.goto('/athlete/drafts');
      const rowB = pageB.locator(`[data-draft-row="round:${groupPostId}"]`);
      await expect(rowB).toBeVisible({ timeout: 15_000 });
      await expect(rowB.locator('[data-draft-finish]')).toHaveCount(0);
      await expect(rowB.locator('[data-draft-discard]')).toHaveCount(0);
    } finally {
      await ctxB.close();
    }

    // Finish → the review screen, with the draft's card.
    await row.locator('[data-draft-finish]').click();
    await page.waitForURL(`**/athlete/drafts/${made.postId}`, { timeout: 20_000 });
    await expect(page.locator('[data-draft-review]')).toBeVisible();
    await expect(page.locator('[data-post-draft="draft"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(course).first()).toBeVisible();

    // Notes are saved as you type; Keep as draft goes back to the list, where
    // the round is now ready to post — and it is still off the owner's grid.
    await page.locator('[data-draft-notes]').fill(`Windy back nine ${stamp()}`);
    await expect(page.locator('[data-draft-saved="saved"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-draft-keep]').click();
    await page.waitForURL('**/athlete/drafts', { timeout: 20_000 });
    await expect(row).toHaveAttribute('data-draft-state', 'draft', { timeout: 15_000 });
    const grid = await apiA.get(`/api/profile/${alpha.id}/media?tab=stats&limit=50`);
    expect(grid.ok(), await readErrorBody(grid)).toBe(true);
    expect(((await grid.json()).items as Array<{ id: string }>).map(i => i.id)).not.toContain(made.postId);
    const feed = await apiA.get('/api/posts?limit=50');
    expect(((await feed.json()).posts as Array<{ id: string }>).map(p => p.id)).not.toContain(made.postId);

    // Review → the notes survived → Post → the feed, and Drafts is empty of it.
    await row.locator('[data-draft-review]').click();
    await page.waitForURL(`**/athlete/drafts/${made.postId}`, { timeout: 20_000 });
    await expect(page.locator('[data-draft-notes]')).toHaveValue(/Windy back nine/);
    await page.locator('[data-draft-post]').click();
    await page.waitForURL(/\/feed\?post=/, { timeout: 20_000 });
    await expect.poll(async () => {
      const f = await apiA.get('/api/posts?limit=50');
      return ((await f.json()).posts as Array<{ id: string; caption: string | null }>).find(p => p.id === made.postId)?.caption ?? null;
    }, { timeout: 15_000 }).toMatch(/Windy back nine/);
    await page.goto('/athlete/drafts');
    await expect(page.locator('[data-drafts-page]')).toBeVisible({ timeout: 15_000 });
    await expect(row).toHaveCount(0);
    // Opening the posted draft's review URL says so.
    await page.goto(`/athlete/drafts/${made.postId}`);
    await expect(page.locator('[data-draft-already-posted]')).toBeVisible({ timeout: 15_000 });
  } finally {
    if (groupPostId) await apiA.delete(`/api/group-posts/${groupPostId}?mode=delete`);
    await apiA.dispose();
  }
});

test('drafts: Discard an unscored round from the list; Delete a finished draft from the review screen', { tag: '@mobile' }, async ({ page }) => {
  test.setTimeout(120_000);
  const alpha = loadQaUser('user.json');
  const apiA = await apiAs('state.json');
  const ids: string[] = [];
  try {
    const unscored = await startRound(apiA, `QA Drafts Unscored ${stamp()}`);
    ids.push(unscored.groupPostId);
    await page.goto('/athlete/drafts');
    const row = page.locator(`[data-draft-row="round:${unscored.groupPostId}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.locator('[data-draft-discard]').click();
    await page.getByRole('button', { name: 'Delete Round', exact: true }).click();
    await expect(row).toHaveCount(0, { timeout: 15_000 });
    expect((await apiA.get(`/api/group-posts/${unscored.groupPostId}`)).status()).toBe(404);
    ids.pop();

    // A finished for-fun round: Delete on the review screen removes it whole.
    const played = await startRound(apiA, `QA Drafts Delete ${stamp()}`);
    ids.push(played.groupPostId);
    const card = await readScorecard(apiA, played.groupPostId);
    await scoreHoles(apiA, cardRowFor(card, alpha.id), Array.from({ length: 9 }, (_, i) => ({ hole_number: i + 1, strokes: 5 })));
    const end = await apiA.patch(`/api/group-posts/${played.groupPostId}`, { data: { status: 'completed' } });
    expect(end.ok(), await readErrorBody(end)).toBe(true);
    await page.goto(`/athlete/drafts/${played.postId}`);
    await expect(page.locator('[data-draft-review]')).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-draft-delete]').click();
    await page.getByRole('button', { name: 'Delete for good', exact: true }).click();
    await page.waitForURL('**/athlete/drafts', { timeout: 20_000 });
    expect((await apiA.get(`/api/posts?postId=${played.postId}`)).status()).toBe(404);
    ids.pop();
  } finally {
    for (const id of ids) await apiA.delete(`/api/group-posts/${id}?mode=delete`);
    await apiA.dispose();
  }
});
