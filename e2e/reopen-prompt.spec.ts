import { test, expect } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';
import { cardRowFor, readScorecard, scoreHoles } from './helpers/sport-events';

// Drafts round PR 4 (Oct 2026): reopening the app with something in progress
// asks — once per app open — Resume / Finish / Discard. Closing the app never
// ends anything. The prompt is one door; Drafts is the other.

const stamp = () => Date.now();

async function startRound(api: Awaited<ReturnType<typeof apiAs>>, course: string) {
  const res = await api.post('/api/group-posts', {
    data: { type: 'golf_round', title: `QA Reopen ${stamp()}`, date: new Date().toISOString().split('T')[0], visibility: 'public', participant_ids: [], golf_data: { course_name: course, round_type: 'outdoor', holes_played: 9 } },
  });
  expect(res.ok(), await readErrorBody(res)).toBe(true);
  const body = await res.json();
  return { groupPostId: body.group_post.id as string, postId: body.group_post.post_id as string };
}

test('reopen: a scored round in progress → the prompt on /feed → Resume; once per app open; Finish → the review screen', { tag: '@mobile' }, async ({ page, browser }) => {
  test.setTimeout(150_000);
  const alpha = loadQaUser('user.json');
  const apiA = await apiAs('state.json');
  let groupPostId = '';
  try {
    const course = `QA Reopen Course ${stamp()}`;
    const made = await startRound(apiA, course);
    groupPostId = made.groupPostId;
    const card = await readScorecard(apiA, groupPostId);
    await scoreHoles(apiA, cardRowFor(card, alpha.id), [{ hole_number: 1, strokes: 4 }]);

    // A fresh app open: the prompt names the round and offers all three.
    await page.goto('/feed');
    const prompt = page.locator(`[data-reopen-prompt="round:${groupPostId}"]`);
    await expect(prompt).toBeVisible({ timeout: 20_000 });
    await expect(prompt.locator('[data-reopen-prompt-item]')).toHaveText(course);
    await expect(prompt.locator('[data-reopen-finish]')).toBeVisible();
    await expect(prompt.locator('[data-reopen-discard]')).toBeVisible();
    await prompt.locator('[data-reopen-resume]').click();
    await page.waitForURL(`**/live/${groupPostId}`, { timeout: 20_000 });

    // The same app open: no second prompt — and never over the live page.
    await page.goto('/feed');
    await expect(page.locator('[data-reopen-prompt]')).toHaveCount(0);
    await page.waitForTimeout(1500);
    await expect(page.locator('[data-reopen-prompt]')).toHaveCount(0);

    // A new app open (a fresh context): Finish → the review screen.
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport: page.viewportSize() ?? undefined });
    try {
      const fresh = await ctx.newPage();
      await fresh.goto('/athlete');
      const again = fresh.locator(`[data-reopen-prompt="round:${groupPostId}"]`);
      await expect(again).toBeVisible({ timeout: 20_000 });
      await again.locator('[data-reopen-finish]').click();
      await fresh.waitForURL(`**/athlete/drafts/${made.postId}`, { timeout: 20_000 });
      await expect(fresh.locator('[data-draft-review]')).toBeVisible();
      // Finished: the next open has nothing in progress to ask about.
      const quiet = await ctx.newPage();
      await quiet.goto('/feed');
      await quiet.waitForTimeout(2500);
      await expect(quiet.locator('[data-reopen-prompt]')).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  } finally {
    if (groupPostId) await apiA.delete(`/api/group-posts/${groupPostId}?mode=delete`);
    await apiA.dispose();
  }
});

test('reopen: a scoreless round offers Discard (no Finish); Discard removes it', { tag: '@mobile' }, async ({ page }) => {
  test.setTimeout(90_000);
  const apiA = await apiAs('state.json');
  let groupPostId = '';
  try {
    const made = await startRound(apiA, `QA Reopen Scoreless ${stamp()}`);
    groupPostId = made.groupPostId;
    await page.goto('/feed');
    const prompt = page.locator(`[data-reopen-prompt="round:${groupPostId}"]`);
    await expect(prompt).toBeVisible({ timeout: 20_000 });
    await expect(prompt.locator('[data-reopen-finish]')).toHaveCount(0);
    // Discard is a two-step door (Tom, Oct 7): the confirm says what goes; Keep it backs out.
    await prompt.locator('[data-reopen-discard]').click();
    await expect(page.getByText('Nothing was recorded, and this cannot be undone.')).toBeVisible();
    await page.getByRole('button', { name: 'Keep it' }).click();
    await expect(prompt).toBeVisible();
    expect((await apiA.get(`/api/group-posts/${groupPostId}`)).status()).toBe(200);
    await prompt.locator('[data-reopen-discard]').click();
    await page.getByRole('button', { name: 'Discard for good' }).click();
    await expect(prompt).toBeHidden({ timeout: 15_000 });
    await expect.poll(async () => (await apiA.get(`/api/group-posts/${groupPostId}`)).status(), { timeout: 15_000 }).toBe(404);
    groupPostId = '';
  } finally {
    if (groupPostId) await apiA.delete(`/api/group-posts/${groupPostId}?mode=delete`);
    await apiA.dispose();
  }
});

test('reopen: a live workout → Finish lands on the share step; a partner is only offered Resume', { tag: '@mobile' }, async ({ page, browser }) => {
  test.setTimeout(120_000);
  const bravo = loadQaUser('user-b.json');
  const apiA = await apiAs('state.json');
  let workoutId = '';
  let groupPostId = '';
  try {
    const started = await apiA.post('/api/workouts', { data: { mode: 'live' } });
    expect(started.ok(), await readErrorBody(started)).toBe(true);
    workoutId = ((await started.json()).session?.id ?? (await started.json()).id) as string;
    await page.goto('/feed');
    const prompt = page.locator(`[data-reopen-prompt="workout:${workoutId}"]`);
    await expect(prompt).toBeVisible({ timeout: 20_000 });
    await prompt.locator('[data-reopen-finish]').click();
    await page.waitForURL(`**/app/workout/${workoutId}?share=1`, { timeout: 20_000 });
    await expect.poll(async () => ((await (await apiA.get(`/api/workouts/${workoutId}`)).json()).session?.status ?? null), { timeout: 15_000 }).toBe('completed');

    // A partner on a round started by alpha: Resume only.
    const made = await apiA.post('/api/group-posts', {
      data: { type: 'golf_round', title: `QA Reopen Partner ${stamp()}`, date: new Date().toISOString().split('T')[0], visibility: 'public', participant_ids: [bravo.id], golf_data: { course_name: `QA Reopen Partner Course ${stamp()}`, round_type: 'outdoor', holes_played: 9 } },
    });
    expect(made.ok(), await readErrorBody(made)).toBe(true);
    groupPostId = (await made.json()).group_post.id as string;
    const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: page.viewportSize() ?? undefined });
    try {
      const pageB = await ctxB.newPage();
      await pageB.goto('/feed');
      const promptB = pageB.locator(`[data-reopen-prompt="round:${groupPostId}"]`);
      await expect(promptB).toBeVisible({ timeout: 20_000 });
      await expect(promptB.locator('[data-reopen-finish]')).toHaveCount(0);
      await expect(promptB.locator('[data-reopen-discard]')).toHaveCount(0);
      await promptB.locator('[data-reopen-later]').click();
      await expect(promptB).toBeHidden();
    } finally {
      await ctxB.close();
    }
  } finally {
    if (groupPostId) await apiA.delete(`/api/group-posts/${groupPostId}?mode=delete`);
    if (workoutId) await apiA.delete(`/api/workouts/${workoutId}`);
    await apiA.dispose();
  }
});
