import { test, expect, type Page, type Locator } from './helpers/test';
import { adminClient, apiAs } from './helpers/qa-user';
import { cleanup } from './helpers/cleanup';

// The golf round as STEPS (Oct 28 2026): one flow, two modes. Picking golf
// opens StepFlow on "Round type" (Playing now + Outdoor pre-selected, today's
// defaults); the course step is the only one that refuses Next (course, and
// the date for an already-played round); indoor drops Conditions; Already
// played adds Scores — the grid and the hole-by-hole Quick entry — and its
// finish is "Create Post" (→ the draft review); Playing now's is "Go Live"
// (→ the live page). The composer's own footer stays off while golf is the
// post type; the step footer is the one set of buttons.

async function openGolf(page: Page): Promise<Locator> {
  await page.goto('/feed');
  await page.getByRole('button', { name: /create a post/i }).click();
  // Post Type → sport selector → Golf. The selector is a z-[60] overlay ON
  // TOP of the composer, so an unscoped /golf/i can resolve to a covered
  // element underneath — scope every click to the overlay.
  await page.getByRole('button', { name: /general post/i }).click();
  const sportSelector = page.locator('div[class*="z-[60]"]');
  await sportSelector.getByPlaceholder('Search sports...').fill('golf');
  await sportSelector.getByRole('button', { name: /golf/i }).first().click();
  const flow = page.locator('[data-step-flow="golf-round"]');
  await expect(flow).toBeVisible({ timeout: 15_000 });
  return flow;
}

const header = (flow: Locator) => flow.locator('[data-step-header]');
/** Next, then wait for the step it opens — a click chained before the new
 *  step has rendered is a click the frame never saw. */
async function next(flow: Locator, reached: RegExp) {
  await flow.locator('[data-step-next]').click();
  await expect(header(flow)).toHaveText(reached);
}

/** Type a custom course on the course step and close the suggestions by
 *  pressing somewhere neutral (the card's heading). */
async function nameCourse(page: Page, courseName: string) {
  const courseInput = page.getByPlaceholder(/search for a golf course/i);
  await courseInput.fill(courseName);
  await page.getByRole('heading', { name: 'Course Details' }).click();
  await page.waitForTimeout(300);
}

test('log an already-played round through the steps and see the scorecard post', { tag: '@smoke' }, async ({ page }) => {
  const courseName = `QA Smoke Course ${Date.now()}`;
  const flow = await openGolf(page);

  // Step 1 — Already played makes it seven steps (Scores joins the list).
  await expect(header(flow)).toHaveText(/Step 1 of 6 · Round type/);
  await page.getByRole('button', { name: /already played/i }).click();
  await expect(header(flow)).toHaveText(/Step 1 of 7 · Round type/);

  // Step 2 — the ONE step that refuses: no course, no Next, and the reason
  // beside the button; the date shows for an already-played round, today.
  await next(flow, /Step 2 of 7 · Course/);
  await expect(flow.locator('[data-step-next]')).toBeDisabled();
  await expect(flow.locator('[data-step-refusal]')).toHaveText('Pick or type a course first');
  await expect(page.locator('#golf-round-date')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await nameCourse(page, courseName);
  await expect(flow.locator('[data-step-next]')).toBeEnabled();

  // Steps 3–5: format, conditions (optional — Skip), players.
  await next(flow, /Step 3 of 7 · Game format/);
  await next(flow, /Step 4 of 7 · Conditions/);
  await flow.locator('[data-step-skip]').click();
  await expect(header(flow)).toHaveText(/Step 5 of 7 · Players/);
  await next(flow, /Step 6 of 7 · Scores/);

  // Step 6 — Scores: the creator's row is on the card before any partner
  // (globalSetup names user A "Edge QA Alpha"). Fill the front nine: a SOLO
  // round renders the shared MultiPlayerScorecardGrid, whose placeholder is
  // an ASCII "-" (exact: true keeps other hyphenated placeholders out).
  await expect(page.getByRole('heading', { name: 'Score Entry' })).toBeVisible();
  const playerRows = page.locator('table').first().locator('tbody tr');
  await expect(playerRows).toHaveCount(1);
  await expect(playerRows.first()).toContainText('Edge');
  const holeInputs = page.getByPlaceholder('-', { exact: true });
  await expect(holeInputs.first()).toBeVisible({ timeout: 10_000 });
  for (let i = 0; i < 9; i++) {
    await holeInputs.nth(i).fill('4');
  }

  // Step 7 — Create: the summary names the course, the story (caption) is
  // here, and the finish is "Create Post".
  await next(flow, /Step 7 of 7 · Create/);
  await expect(flow.locator('[data-round-summary-row="course"]')).toContainText(courseName);
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeVisible();
  const finish = flow.locator('[data-step-finish]');
  await expect(finish).toHaveText(/Create Post/);
  await finish.click();

  // Modal closes; the round is FINISHED and its post is a DRAFT (253): the
  // composer lands on the REVIEW screen — the draft's card with the course
  // name, notes, and Post — and the feed does not carry it yet.
  await page.waitForURL(/\/athlete\/drafts\/[0-9a-f-]+$/, { timeout: 20_000 });
  await expect(page.locator('[data-draft-review]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-post-draft="draft"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(courseName).first()).toBeVisible({ timeout: 20_000 });

  // Post — the one extra tap Finish-vs-Post costs — and the feed has it.
  await page.locator('[data-draft-post]').click();
  await page.waitForURL(/\/feed\?post=/, { timeout: 20_000 });
  await page.goto('/feed');
  await expect(page.getByText(courseName).first()).toBeVisible({ timeout: 20_000 });
});

// The defaults and the frame: Playing now + Outdoor pre-selected (six steps),
// no date field for a live round, the course step refuses until a course is
// named, Back works, and an untouched flow closes without a discard prompt —
// the seeded creator row is not work in progress.
test('the steps open on Playing now + Outdoor; only the course step refuses; an untouched flow closes clean', async ({ page }) => {
  const flow = await openGolf(page);
  await expect(header(flow)).toHaveText(/Step 1 of 6 · Round type/);
  await expect(page.getByRole('button', { name: 'Playing now' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Outdoor' })).toHaveAttribute('aria-pressed', 'true');
  // The composer's own footer is off: one Back / Next row, no second set.
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toHaveCount(0);

  await next(flow, /Step 2 of 6 · Course/);
  await expect(page.locator('#golf-round-date')).toHaveCount(0); // a live round is today
  await expect(flow.locator('[data-step-next]')).toBeDisabled();
  await expect(flow.locator('[data-step-refusal]')).toHaveText('Pick or type a course first');

  // Indoor drops Conditions: five steps.
  await flow.locator('[data-step-back]').click();
  await expect(header(flow)).toHaveText(/Step 1 of 6 · Round type/);
  await page.getByRole('button', { name: 'Indoor' }).click();
  await expect(header(flow)).toHaveText(/Step 1 of 5 · Round type/);
  await page.getByRole('button', { name: 'Outdoor' }).click();
  await expect(header(flow)).toHaveText(/Step 1 of 6 · Round type/);

  await page.getByRole('button', { name: 'Close modal' }).click();
  await expect(page.getByText(/discard/i)).toHaveCount(0);
});

// Playing now, through the UI to Go Live (no spec clicked Go Live before):
// the finish is the red Go Live, and it lands IN the round.
test('Playing now: the steps end in Go Live and open the live round', async ({ page }) => {
  const api = await apiAs('state.json');
  const courseName = `QA Live Steps ${Date.now()}`;
  let groupPostId = '';
  try {
    const flow = await openGolf(page);
    await next(flow, /Step 2 of 6 · Course/);
    await nameCourse(page, courseName);
    await next(flow, /Step 3 of 6 · Game format/);
    await next(flow, /Step 4 of 6 · Conditions/);
    await next(flow, /Step 5 of 6 · Players/);
    await next(flow, /Step 6 of 6 · Start/);
    await expect(flow.locator('[data-round-summary-row="players"]')).toContainText('Just you');
    const finish = flow.locator('[data-step-finish]');
    await expect(finish).toHaveText(/Go Live/);
    await finish.click();
    await page.waitForURL(/\/live\/[0-9a-f-]+/, { timeout: 30_000 });
    groupPostId = page.url().match(/\/live\/([0-9a-f-]+)/)?.[1] ?? '';
    expect(groupPostId).not.toBe('');
  } finally {
    await cleanup('golf-steps-go-live', [
      () => groupPostId && api.delete(`/api/group-posts/${groupPostId}`),
      () => api.dispose(),
    ]);
  }
});

// The phone-first path (#345 + phone polish pass): the Scores step's headline
// "Quick entry" button opens the hole-by-hole stepper, and a score committed
// there lands back in the grid. Asserted at 375px — the tightest mainstream
// phone — and every step on the way fits the viewport.
test('@mobile Quick entry opens the stepper and writes back to the grid', { tag: '@smoke' }, async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const flow = await openGolf(page);
  const noOverflow = async () => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  };

  await page.getByRole('button', { name: /already played/i }).click();
  await noOverflow();
  await next(flow, /Step 2 of 7 · Course/);
  await nameCourse(page, `QA Phone Course ${Date.now()}`);
  await noOverflow();
  await next(flow, /Step 3 of 7 · Game format/);
  await noOverflow();
  await next(flow, /Step 4 of 7 · Conditions/);
  await noOverflow();
  await next(flow, /Step 5 of 7 · Players/);
  await next(flow, /Step 6 of 7 · Scores/);
  await expect(page.getByRole('heading', { name: 'Score Entry' })).toBeVisible({ timeout: 15_000 });
  await noOverflow();

  const quickEntry = page.getByRole('button', { name: 'Quick entry' });
  await expect(quickEntry).toBeVisible();
  // 44px touch floor, held at 375px.
  const box = await quickEntry.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);

  await quickEntry.click();

  // Stepper is open: hole context line plus both wheels.
  const strokes = page.getByRole('spinbutton', { name: 'Strokes' });
  await expect(strokes).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Putts' })).toBeVisible();

  // Nothing may overflow the 375px viewport with the stepper open.
  await noOverflow();

  // Commit hole 1: typing a digit on the wheel commits it (same contract the
  // AT/keyboard path uses).
  await strokes.press('5');
  await expect(strokes).toHaveAttribute('aria-valuenow', '5');

  // "Save Scores" is the LAST hole's footer button (every other hole shows
  // Next) — jump straight there. The stepper overlay is the only z-[60]
  // layer open, which scopes the numeric button away from the page behind.
  const stepper = page.locator('div[class*="z-[60]"]');
  await stepper.getByRole('button', { name: '18', exact: true }).click();
  await stepper.getByRole('button', { name: 'Save Scores' }).click();

  // Modal closed; the grid's hole-1 cell now carries the committed score.
  await expect(strokes).toBeHidden();
  const holeInputs = page.getByPlaceholder('-', { exact: true });
  await expect(holeInputs.first()).toHaveValue('5');
});

// The tee rows (Oct 29 2026, Tom's spec: "colour, yardage, and any other
// existing tee details"): a catalog course's tee select names each tee with
// its yardage and rating / slope; the compact sport row stands above the
// steps with both doors. Self-seeded — staging holds no catalog courses.
test('a catalog tee shows its yards and rating / slope; the sport row is one line with Change and Remove sport', async ({ page }) => {
  const admin = adminClient();
  const stamp = Date.now();
  const name = `QA Tee Links ${stamp}`;
  let courseId = '';
  try {
    const seeded = await admin
      .from('golf_courses')
      .insert({
        external_source: 'qa-e2e',
        external_id: `tees-${stamp}`,
        name,
        total_par: 36,
        holes_count: 9,
        section_kind: 'nine',
        course_rating: { white: 71.2, blue: 72.9 },
        slope_rating: { white: 128, blue: 134 },
        hole_data: Array.from({ length: 9 }, (_, i) => ({ number: i + 1, par: 4, yardage: { white: 350, blue: 380 }, handicap: i + 1 })),
      })
      .select('id')
      .single();
    expect(seeded.error, seeded.error?.message).toBeNull();
    courseId = seeded.data!.id as string;

    const flow = await openGolf(page);
    const row = page.locator('[data-post-type-compact]');
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: 'Change sport' })).toBeVisible();
    await expect(row.locator('[data-post-type-clear]')).toBeVisible();
    await expect(page.getByText('Post Type', { exact: true })).toHaveCount(0);

    await next(flow, /Step 2 of 6 · Course/);
    const courseInput = page.getByPlaceholder(/search for a golf course/i);
    await courseInput.fill('QA Tee Links');
    await page.locator('div.absolute.max-h-60 button', { hasText: name }).first().click({ timeout: 15_000 });
    await expect(courseInput).toHaveValue(name);

    const tees = page.locator('select').filter({ has: page.locator('option', { hasText: 'Select tees' }) }).first();
    await expect(tees).toBeVisible();
    // Hardest first (blue 72.9 over white 71.2), each with yards · rating / slope.
    await expect(tees.locator('option')).toHaveText(['Select tees', 'Blue · 3,420 yds · 72.9 / 134', 'White · 3,150 yds · 71.2 / 128']);
    await tees.selectOption('white');
    // The summary on the last step names the tee the same way.
    await next(flow, /Step 3 of 6 · Game format/);
    await next(flow, /Step 4 of 6 · Conditions/);
    await next(flow, /Step 5 of 6 · Players/);
    await next(flow, /Step 6 of 6 · Start/);
    await expect(flow.locator('[data-round-summary-row="tee"]')).toContainText('White · 3,150 yds · 71.2 / 128');
  } finally {
    await cleanup('golf-steps-tees', [
      () => courseId && admin.from('golf_courses').delete().eq('id', courseId),
    ]);
  }
});
