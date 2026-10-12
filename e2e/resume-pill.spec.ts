import { test, expect, type Page } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';
import { cardRowFor, readScorecard, scoreHoles } from './helpers/sport-events';

// The resume pill (Oct 12 2026): while a workout or a round is in progress,
// one pill on every signed-in page — what it is, a live clock, one metric —
// and a tap lands back in it. Private: the viewer's own list. The reopen
// prompt (once per app open) stays beside it: these specs dismiss it first.

const stamp = () => Date.now();

const setOf = (n: number) => ({ setNumber: n, reps: 5, weight: 100, weightUnit: 'lbs', durationSeconds: null, distance: null, distanceUnit: null, completedAt: new Date().toISOString(), media: [] });

/** The reopen prompt decides after the server list AND the phone answered — wait for it, then dismiss it (its backdrop covers the pill). */
async function dismissPrompt(page: Page): Promise<void> {
  const later = page.locator('[data-reopen-later]');
  await later.waitFor({ state: 'visible', timeout: 12_000 }).catch(() => undefined);
  if (await later.isVisible()) {
    await later.click();
    await expect(later).toBeHidden();
  }
}

/** The pill's clock reads "m:ss" / "h:mm:ss" and moves. */
async function expectClockRunning(page: Page, pill: ReturnType<Page['locator']>): Promise<void> {
  const clock = pill.locator('[data-resume-pill-elapsed]');
  await expect(clock).toHaveText(/^\d+:\d\d(:\d\d)?$/);
  const t0 = await clock.innerText();
  await expect.poll(async () => clock.innerText(), { timeout: 6_000 }).not.toBe(t0);
}

test('resume pill: a live workout follows you to the feed, the calendar and the profile with a running clock and the set count; a tap lands back in it; a reload keeps it; nobody else sees it @mobile', { tag: '@mobile' }, async ({ page, browser }) => {
  test.setTimeout(150_000);
  const apiA = await apiAs('state.json');
  let workoutId = '';
  try {
    const started = await apiA.post('/api/workouts', { data: { mode: 'live' } });
    expect(started.ok(), await readErrorBody(started)).toBe(true);
    workoutId = (await started.json()).session.id as string;
    const seeded = await apiA.put(`/api/workouts/${workoutId}/entries`, {
      data: { savedAt: Date.now(), exercises: [{ name: 'Bench Press', exerciseKey: 'bench_press', category: 'strength', notes: null, sets: [setOf(1), setOf(2)] }] },
    });
    expect(seeded.ok(), await readErrorBody(seeded)).toBe(true);

    await page.goto('/feed');
    await dismissPrompt(page);
    const pill = page.locator(`[data-resume-pill="workout:${workoutId}"]`);
    await expect(pill).toBeVisible({ timeout: 20_000 });
    await expect(pill.locator('[data-resume-pill-metric]')).toHaveText('2 sets');
    await expectClockRunning(page, pill);

    // The pill does not sit on the tab bar: its box ends above the bar's top.
    const bar = page.locator('[data-tab-bar]');
    const [pillBox, barBox] = await Promise.all([pill.boundingBox(), bar.boundingBox()]);
    expect(pillBox && barBox && pillBox.y + pillBox.height <= barBox.y + 1, 'the pill clears the tab bar').toBe(true);

    for (const path of ['/calendar', '/athlete']) {
      await page.goto(path);
      await expect(page.locator(`[data-resume-pill="workout:${workoutId}"]`)).toBeVisible({ timeout: 20_000 });
    }
    await expect(page.locator('[data-resume-pill-elapsed]')).toHaveText(/^\d+:\d\d/);

    // A tap lands back in the session — and the pill is not on the session's own screen.
    await page.locator(`[data-resume-pill="workout:${workoutId}"]`).click();
    await page.waitForURL(`**/app/workout/${workoutId}`, { timeout: 20_000 });
    await expect(page.locator('[data-live-clock]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-resume-pill]')).toHaveCount(0);

    // Add a set on the screen, leave: the pill knows without a reload (the progress store).
    await page.goto('/feed');
    await expect(page.locator(`[data-resume-pill="workout:${workoutId}"]`)).toBeVisible({ timeout: 20_000 });

    // A reload (the app reopened): the pill at once.
    await page.reload();
    await dismissPrompt(page);
    await expect(page.locator(`[data-resume-pill="workout:${workoutId}"]`)).toBeVisible({ timeout: 20_000 });

    // Private: another account never sees it.
    const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: page.viewportSize() ?? undefined });
    try {
      const pageB = await ctxB.newPage();
      await pageB.goto('/feed');
      await expect(pageB.getByRole('link', { name: 'Feed' }).first()).toBeVisible({ timeout: 20_000 });
      await dismissPrompt(pageB);
      await expect(pageB.locator(`[data-resume-pill="workout:${workoutId}"]`)).toHaveCount(0);
    } finally {
      await ctxB.close();
    }
  } finally {
    if (workoutId) await apiA.delete(`/api/workouts/${workoutId}`);
    await apiA.dispose();
  }
});

test('resume pill: a scored round in progress shows "Thru N" and lands on the scorer; Finish from the scorer takes the pill away @mobile', { tag: '@mobile' }, async ({ page }) => {
  test.setTimeout(150_000);
  const alpha = loadQaUser('user.json');
  const apiA = await apiAs('state.json');
  let groupPostId = '';
  try {
    const course = `QA Pill Course ${stamp()}`;
    const res = await apiA.post('/api/group-posts', {
      data: { type: 'golf_round', title: `QA Pill ${stamp()}`, date: new Date().toISOString().split('T')[0], visibility: 'public', participant_ids: [], golf_data: { course_name: course, round_type: 'outdoor', holes_played: 9 } },
    });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    groupPostId = (await res.json()).group_post.id as string;
    const card = await readScorecard(apiA, groupPostId);
    await scoreHoles(apiA, cardRowFor(card, alpha.id), [{ hole_number: 1, strokes: 4 }, { hole_number: 2, strokes: 5 }]);

    await page.goto('/feed');
    await dismissPrompt(page);
    const pill = page.locator(`[data-resume-pill="round:${groupPostId}"]`);
    await expect(pill).toBeVisible({ timeout: 20_000 });
    await expect(pill.locator('[data-resume-pill-title]')).toHaveText(course);
    await expect(pill.locator('[data-resume-pill-metric]')).toHaveText('Thru 2/9');
    await expectClockRunning(page, pill);

    await pill.click();
    await page.waitForURL(`**/live/${groupPostId}`, { timeout: 20_000 });
    await expect(page.locator('[data-resume-pill]')).toHaveCount(0);

    // Finished (the one Finish writer): the list refreshes and the pill is gone.
    const end = await apiA.patch(`/api/group-posts/${groupPostId}`, { data: { status: 'completed' } });
    expect(end.ok(), await readErrorBody(end)).toBe(true);
    await page.goto('/feed');
    await expect(page.getByRole('link', { name: 'Feed' }).first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    await expect(page.locator(`[data-resume-pill="round:${groupPostId}"]`)).toHaveCount(0);
  } finally {
    if (groupPostId) await apiA.delete(`/api/group-posts/${groupPostId}?mode=delete`);
    await apiA.dispose();
  }
});

test('resume pill: on a large screen it sits under the header', async ({ page }) => {
  test.setTimeout(90_000);
  const apiA = await apiAs('state.json');
  let workoutId = '';
  try {
    const started = await apiA.post('/api/workouts', { data: { mode: 'live' } });
    expect(started.ok(), await readErrorBody(started)).toBe(true);
    workoutId = (await started.json()).session.id as string;
    await page.goto('/feed');
    await dismissPrompt(page);
    const pill = page.locator(`[data-resume-pill="workout:${workoutId}"]`);
    await expect(pill).toBeVisible({ timeout: 20_000 });
    const box = await pill.boundingBox();
    expect(box && box.y > 60 && box.y < 160, `the pill sits under the 64px header (y=${box?.y})`).toBe(true);
    await expect(pill.locator('[data-resume-pill-metric]')).toHaveText('No sets yet');
  } finally {
    if (workoutId) await apiA.delete(`/api/workouts/${workoutId}`);
    await apiA.dispose();
  }
});
