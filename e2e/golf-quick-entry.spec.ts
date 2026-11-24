import { test, expect, type Page, type Locator } from './helpers/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';
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
  await sportSelector.getByPlaceholder('Search sports').fill('golf');
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
  await expect(header(flow)).toHaveText(/Step 1 of 7 · Round type/);
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
  await expect(header(flow)).toHaveText(/Step 1 of 7 · Round type/);
  await expect(page.getByRole('button', { name: 'Playing now' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Outdoor' })).toHaveAttribute('aria-pressed', 'true');
  // The composer's own footer is off: one Back / Next row, no second set.
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toHaveCount(0);

  await next(flow, /Step 2 of 7 · Course/);
  await expect(page.locator('#golf-round-date')).toHaveCount(0); // a live round is today
  await expect(flow.locator('[data-step-next]')).toBeDisabled();
  await expect(flow.locator('[data-step-refusal]')).toHaveText('Pick or type a course first');

  // Indoor drops Conditions: five steps.
  await flow.locator('[data-step-back]').click();
  await expect(header(flow)).toHaveText(/Step 1 of 7 · Round type/);
  await page.getByRole('button', { name: 'Indoor' }).click();
  await expect(header(flow)).toHaveText(/Step 1 of 6 · Round type/);
  await page.getByRole('button', { name: 'Outdoor' }).click();
  await expect(header(flow)).toHaveText(/Step 1 of 7 · Round type/);

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
    await next(flow, /Step 2 of 7 · Course/);
    await nameCourse(page, courseName);
    await next(flow, /Step 3 of 7 · Game format/);
    await next(flow, /Step 4 of 7 · Conditions/);
    await next(flow, /Step 5 of 7 · Players/);
    await next(flow, /Step 6 of 7 · Scores/);
    await next(flow, /Step 7 of 7 · Start/);
    // The players, stacked (Oct 29 2026): the creator's row alone — picture, name.
    await expect(flow.locator('[data-round-summary-row="players"] [data-round-player]')).toHaveCount(1);
    await expect(flow.locator('[data-round-summary-row="players"]')).toContainText('Edge');
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

    await next(flow, /Step 2 of 7 · Course/);
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
    await next(flow, /Step 3 of 7 · Game format/);
    await next(flow, /Step 4 of 7 · Conditions/);
    await next(flow, /Step 5 of 7 · Players/);
    await next(flow, /Step 6 of 7 · Scores/);
    await next(flow, /Step 7 of 7 · Start/);
    await expect(flow.locator('[data-round-summary-row="tee"]')).toContainText('White · 3,150 yds · 71.2 / 128');
  } finally {
    await cleanup('golf-steps-tees', [
      () => courseId && admin.from('golf_courses').delete().eq('id', courseId),
    ]);
  }
});

// The live path's look (Oct 29 2026, Tom's refinement spec): purple is the
// one selected colour; Playing now keeps a red dot while selected; the course
// card's two buttons open one panel at a time with the HCP row on light
// purple; no "(optional)" labels, no handicap paragraph; the Conditions
// step's °F / °C toggle writes the ACCOUNT (293) — Settings shows it after a
// reload; Playing Partners is a heading without an icon and without the
// "Playing with anyone" line. Self-seeded course with coordinates.
test('the live path look: purple selection, Show Map | Official Scorecard one at a time, the °F / °C toggle on the account', async ({ page }) => {
  const admin = adminClient();
  const api = await apiAs('state.json');
  const stamp = Date.now();
  const name = `QA Look Links ${stamp}`;
  let courseId = '';
  let osmId = '';
  try {
    const seeded = await admin
      .from('golf_courses')
      .insert({
        external_source: 'qa-e2e',
        external_id: `look-${stamp}`,
        name,
        total_par: 36,
        holes_count: 9,
        section_kind: 'nine',
        lat: 45.4,
        lng: -75.7,
        course_rating: { white: 71.2 },
        slope_rating: { white: 128 },
        hole_data: Array.from({ length: 9 }, (_, i) => ({ number: i + 1, par: 4, yardage: { white: 350 }, handicap: i + 1 })),
      })
      .select('id')
      .single();
    expect(seeded.error, seeded.error?.message).toBeNull();
    courseId = seeded.data!.id as string;

    // Step 1 (the mechanical dialect, Nov 23 2026): two key switches — the pressed key is raised;
    // the broadcast dot is lit while Playing now is the pressed key, dimmed when it is not.
    const flow = await openGolf(page);
    const playingNow = page.getByRole('button', { name: 'Playing now' });
    await expect(playingNow).toHaveAttribute('aria-pressed', 'true');
    await expect(playingNow.locator('[data-live-dot]')).toHaveAttribute('data-on', '');
    await expect(page.getByRole('button', { name: 'Outdoor' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Already played' }).click();
    await expect(playingNow).toHaveAttribute('aria-pressed', 'false');
    await expect(playingNow.locator('[data-live-dot]')).not.toHaveAttribute('data-on', '');
    await playingNow.click();
    // The info button swaps the first switch for a panel of the same height: nothing below moves.
    const roundType = page.getByRole('group', { name: 'Round type' });
    const before = await roundType.boundingBox();
    await page.getByRole('button', { name: 'About when the round is' }).click();
    await expect(page.locator('[data-round-when-info]')).toBeVisible();
    expect((await roundType.boundingBox())!.y).toBe(before!.y);
    await page.getByRole('button', { name: 'About when the round is' }).click();
    await expect(page.locator('[data-round-when-info]')).toHaveCount(0);
    await expect(playingNow).toBeVisible();

    // Step 2: the seeded course → Show Map | Official Scorecard, one open at a time; no "(optional)", no handicap line.
    await next(flow, /Step 2 of 7 · Course/);
    await page.getByPlaceholder(/search for a golf course/i).fill('QA Look Links');
    await page.locator('div.absolute.max-h-60 button', { hasText: name }).first().click({ timeout: 15_000 });
    await expect(page.locator('[data-course-chosen]')).toHaveClass(/bg-brand-soft/);
    const showMap = page.locator('[data-course-show-map]');
    const showCard = page.locator('[data-course-show-scorecard]');
    await expect(showMap).toHaveText(/Show Map/, { timeout: 15_000 });
    await expect(showCard).toHaveText(/Official Scorecard/);
    await expect(page.getByText('View on map')).toHaveCount(0);
    await showCard.click();
    await expect(showCard).toHaveText(/Hide/);
    await expect(page.locator('[data-course-scorecard-row="hcp"]').first()).toHaveClass(/bg-brand-soft/, { timeout: 15_000 });
    // One row (Oct 30 2026): the Total column boxed and bold; a nine ends in Total.
    await expect(page.locator('[data-course-scorecard-sum="total"]').first()).toHaveClass(/font-bold/);
    await expect(page.locator('[data-course-scorecard-sum="total"]').first()).toHaveClass(/border-l-2/);
    await showMap.click();
    await expect(showMap).toHaveText(/Hide/);
    await expect(showCard).toHaveText(/Official Scorecard/);
    await expect(page.locator('[data-course-scorecard]')).toHaveCount(0);
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('(optional)')).toHaveCount(0);
    await expect(page.getByText(/unlock your estimated handicap/)).toHaveCount(0);

    // A course with a location and no sheet — a catalog row whose detail
    // has already been asked (hydrated_at set) and answered without holes,
    // the shape of production's map-only rows — gets NO Official Scorecard
    // button: the summary says "Not fully mapped" and Show Map stands alone
    // (Oct 30 2026, Tom's empty panel). Seeded as qa-e2e so the sweep owns it.
    const osmName = `QA Map Only Links ${stamp}`;
    const osm = await admin
      .from('golf_courses')
      .insert({ external_source: 'qa-e2e', external_id: `maponly-${stamp}`, name: osmName, total_par: 72, holes_count: 18, lat: 45.41, lng: -75.71, hydrated_at: new Date().toISOString() })
      .select('id')
      .single();
    expect(osm.error, osm.error?.message).toBeNull();
    osmId = osm.data!.id as string;
    await page.getByPlaceholder(/search for a golf course/i).fill('QA Map Only Links');
    await page.locator('div.absolute.max-h-60 button', { hasText: osmName }).first().click({ timeout: 15_000 });
    await expect(page.locator('[data-course-chosen]')).toContainText(osmName);
    // The detail answers without holes → the button is dropped (the
    // summary's "Not fully mapped" follows the slower map-lines request).
    await expect(page.locator('[data-course-show-scorecard]')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('[data-course-show-map]')).toBeVisible();
    await expect(page.locator('[data-course-scorecard]')).toHaveCount(0);
    // …and asks for one on its own (Oct 31 2026): the provider by name. A QA-named row matches nothing → the honest line.
    await expect(page.locator('[data-course-sheet-none]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-course-find-sheet]')).toHaveCount(0);
    // Back to the real course for the rest of the walk.
    await page.getByPlaceholder(/search for a golf course/i).fill('QA Look Links');
    await page.locator('div.absolute.max-h-60 button', { hasText: name }).first().click({ timeout: 15_000 });
    await expect(page.locator('[data-course-chosen]')).toContainText(name);

    // Step 3: the pressed format is purple.
    await next(flow, /Step 3 of 7 · Game format/);
    await expect(page.getByRole('button', { name: 'Stroke Play' })).toHaveClass(/bg-brand/);

    // Step 4: no "Optional" line; °C flips the field's unit and lands on the account.
    await next(flow, /Step 4 of 7 · Conditions/);
    await expect(page.getByText(/skip if you/)).toHaveCount(0);
    // Nov 19 2026 (Tom: the unit toggle pushed the temperature box out of line on
    // web): the three controls share one top edge, and the toggle sits beside the box.
    const tops = await Promise.all(['#golf-weather', '#golf-temperature', '#golf-wind'].map(async sel => (await page.locator(sel).boundingBox())!.y));
    expect(Math.abs(tops[1] - tops[0]), `temperature ${tops[1]} vs weather ${tops[0]}`).toBeLessThanOrEqual(2);
    expect(Math.abs(tops[2] - tops[0])).toBeLessThanOrEqual(2);
    const tempBox = (await page.locator('#golf-temperature').boundingBox())!;
    const unitBox = (await page.locator('[data-golf-temp-units]').boundingBox())!;
    expect(unitBox.x).toBeGreaterThanOrEqual(tempBox.x + tempBox.width - 1);
    expect(unitBox.y + unitBox.height / 2).toBeGreaterThan(tempBox.y);
    expect(unitBox.y + unitBox.height / 2).toBeLessThan(tempBox.y + tempBox.height);
    await page.locator('[data-golf-temp-unit="°C"]').click();
    await expect(page.locator('[data-golf-temp-unit="°C"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('label[for="golf-temperature"]')).toHaveText('Temperature (°C)');
    // The ACCOUNT holds it (293): the row itself, not the device.
    const me = loadQaUser('user.json');
    await expect.poll(async () => (await admin.from('profiles').select('unit_system').eq('id', me.id).single()).data?.unit_system, { timeout: 15_000 }).toBe('metric');

    // Step 5: the heading, no icon, no helper; Add Others is the purple CTA.
    await next(flow, /Step 5 of 7 · Players/);
    await expect(page.getByRole('heading', { name: 'Playing Partners' })).toBeVisible();
    await expect(page.getByText(/Playing with anyone/)).toHaveCount(0);
    await expect(page.locator('[data-round-add-players]')).toHaveClass(/ea-cta/);

    // The account's choice shows in Settings after a fresh load — and is restored below.
    await page.goto('/settings?tab=account');
    await expect(page.locator('[data-units-choice="km"]')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
    await expect(page.getByText(/Saved on your account/)).toBeVisible();
  } finally {
    await cleanup('golf-steps-look', [
      () => api.patch('/api/settings/units', { data: { system: 'imperial' } }),
      () => courseId && admin.from('golf_courses').delete().eq('id', courseId),
      () => osmId && admin.from('golf_courses').delete().eq('id', osmId),
      () => api.dispose(),
    ]);
  }
});

// Oct 31 2026 (Tom: scorecards missing in the preview and while playing): a
// course with NO sheet still has a card everywhere, before any score. Holeless
// row seeded; preview names the player; Go Live, close
// the scorer, View Full Scorecard shows all 18 holes.
test('a course with no sheet: the preview and the full scorecard before any score @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const api = await apiAs('state.json');
  const stamp = Date.now();
  const name = `QA No Sheet Links ${stamp}`;
  let courseId = '';
  let groupPostId = '';
  try {
    const seeded = await admin.from('golf_courses').insert({ external_source: 'qa-e2e', external_id: `nosheet-${stamp}`, name, total_par: 72, holes_count: 18, lat: 45.42, lng: -75.72, hydrated_at: new Date().toISOString() }).select('id').single();
    expect(seeded.error, seeded.error?.message).toBeNull();
    courseId = seeded.data!.id as string;
    const pick = async () => {
      await page.getByPlaceholder(/search for a golf course/i).fill('QA No Sheet Links');
      await page.locator('div.absolute.max-h-60 button', { hasText: name }).first().click({ timeout: 15_000 });
      await expect(page.locator('[data-course-chosen]')).toContainText(name);
    };
    let flow = await openGolf(page);
    await page.getByRole('button', { name: /already played/i }).click();
    await next(flow, /Step 2 of 7/);
    await pick();
    // No manual entry on a catalog course (Tom, Oct 31).
    await expect(page.getByRole('heading', { name: /Course Par & Yardage/ })).toHaveCount(0);
    await next(flow, /Step 3 of 7/);
    await next(flow, /Step 4 of 7/);
    await next(flow, /Step 5 of 7/);
    await next(flow, /Step 6 of 7/);
    await next(flow, /Step 7 of 7/);
    await page.locator('[data-round-preview]').click();
    const preview = page.getByText('Post Preview').locator('xpath=ancestor::div[contains(@class,"rounded")][1]');
    await expect(preview).toContainText('Edge');
    await expect(preview).not.toContainText('LIVE');
    await page.goto('/feed');

    flow = await openGolf(page);
    await next(flow, /Step 2 of 7/);
    await pick();
    await next(flow, /Step 3 of 7/);
    await next(flow, /Step 4 of 7/);
    await next(flow, /Step 5 of 7/);
    await next(flow, /Step 6 of 7/);
    await next(flow, /Step 7 of 7/);
    await flow.locator('[data-step-finish]').click();
    await page.waitForURL(/\/live\/[0-9a-f-]+/, { timeout: 30_000 });
    groupPostId = page.url().match(/\/live\/([0-9a-f-]+)/)?.[1] ?? '';
    // The scorer opens over the page on arrival; close it to reach the card.
    await page.waitForTimeout(2500);
    const closeScorer = page.getByRole('button', { name: /^close/i }).last();
    if (await closeScorer.count()) await closeScorer.click();
    await page.getByRole('button', { name: /View Full Scorecard/i }).first().click();
    const tab = page.getByRole('tab', { name: /Full Scorecard/i });
    if (await tab.count()) await tab.first().click();
    const panel = page.locator('#round-panel-scorecard');
    await expect(panel.locator('table')).toHaveCount(2, { timeout: 15_000 });
    await expect(panel).toContainText('OUT');
    await expect(panel).toContainText('18');
    // No yardage is known for this course: no yardage row is drawn (never a row of dashes).
    await expect(panel.locator('[data-round-yardage-row]')).toHaveCount(0);
  } finally {
    await cleanup('golf-no-sheet', [
      () => groupPostId && api.delete(`/api/group-posts/${groupPostId}`),
      () => courseId && admin.from('golf_courses').delete().eq('id', courseId),
      () => api.dispose(),
    ]);
  }
});

// Oct 31 2026: the score grid is back on Playing now, and a score entered
// there survives Go Live.
test('Playing now: a score entered in the Scores step reaches the live round', async ({ page }) => {
  const api = await apiAs('state.json');
  let groupPostId = '';
  try {
    const flow = await openGolf(page);
    await next(flow, /Step 2 of 7 · Course/);
    await nameCourse(page, `QA Live Grid ${Date.now()}`);
    await next(flow, /Step 3 of 7/);
    await next(flow, /Step 4 of 7/);
    await next(flow, /Step 5 of 7/);
    await next(flow, /Step 6 of 7 · Scores/);
    await expect(page.getByRole('heading', { name: 'Score Entry' })).toBeVisible();
    await page.getByPlaceholder('-', { exact: true }).first().fill('5');
    await next(flow, /Step 7 of 7 · Start/);
    await flow.locator('[data-step-finish]').click();
    await page.waitForURL(/\/live\/[0-9a-f-]+/, { timeout: 30_000 });
    groupPostId = page.url().match(/\/live\/([0-9a-f-]+)/)?.[1] ?? '';
    await expect.poll(async () => {
      const body = await (await api.get(`/api/group-posts/${groupPostId}/scorecard`)).json();
      return body.scorecard?.participants?.[0]?.scores?.hole_scores?.find((h: { hole_number: number }) => h.hole_number === 1)?.strokes;
    }, { timeout: 15_000 }).toBe(5);
    // …and the round is still the full 18, not a 9 derived from one score.
    const final = await (await api.get(`/api/group-posts/${groupPostId}/scorecard`)).json();
    expect(final.scorecard?.golf_data?.holes_played).toBe(18);
  } finally {
    await cleanup('golf-live-grid', [
      // A round with a score is a result the API will not delete; purge QA's own.
      () => groupPostId && adminClient().from('group_posts').delete().eq('id', groupPostId),
      () => api.dispose(),
    ]);
  }
});

// Oct 31 2026 (Tom: the map knows the holes, so why no scorecard?): a course with
// complete map lines and no provider card shows a card built from the map, and
// the round carries its pars. Real-shaped geometry, 18 holes, par 72.
test('a course with map lines and no card: the scorecard comes from the map and the round carries its pars', async ({ page }) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const api = await apiAs('state.json');
  const stamp = Date.now();
  const name = `QA Map Card Links ${stamp}`;
  let courseId = '';
  let groupPostId = '';
  try {
    const pars = [4, 5, 3, 5, 3, 4, 4, 3, 5, 5, 4, 3, 4, 5, 3, 5, 3, 4];
    const holes = pars.map((par, i) => ({ hole: i + 1, par, line: [[45.4 + i * 0.01, -75.7], [45.4 + i * 0.01 + 0.003, -75.7]] }));
    const seeded = await admin.from('golf_courses').insert({ external_source: 'qa-e2e', external_id: `mapcard-${stamp}`, name, total_par: 72, holes_count: 18, lat: 45.43, lng: -75.73, hydrated_at: new Date().toISOString(), hole_geometry: { holes, greens: [], source: 'osm' }, hole_geometry_at: new Date().toISOString() }).select('id').single();
    expect(seeded.error, seeded.error?.message).toBeNull();
    courseId = seeded.data!.id as string;
    const flow = await openGolf(page);
    await next(flow, /Step 2 of 7/);
    await page.getByPlaceholder(/search for a golf course/i).fill('QA Map Card Links');
    await page.locator('div.absolute.max-h-60 button', { hasText: name }).first().click({ timeout: 15_000 });
    const show = page.locator('[data-course-show-scorecard]');
    await expect(show).toBeVisible({ timeout: 15_000 });
    await show.click();
    await expect(page.locator('[data-course-scorecard-map]')).toBeVisible();
    // It also asks for a real card, silently: no line, and the map card stays on a miss.
    await page.waitForTimeout(2500);
    await expect(page.locator('[data-course-sheet-looking], [data-course-sheet-none]')).toHaveCount(0);
    await expect(page.locator('[data-course-scorecard-map]')).toBeVisible();
    await expect(page.locator('[data-course-scorecard-row="par"] [data-course-scorecard-sum="total"]').first()).toHaveText('72');
    await next(flow, /Step 3 of 7/);
    await next(flow, /Step 4 of 7/);
    await next(flow, /Step 5 of 7/);
    await next(flow, /Step 6 of 7/);
    await next(flow, /Step 7 of 7/);
    await flow.locator('[data-step-finish]').click();
    await page.waitForURL(/\/live\/[0-9a-f-]+/, { timeout: 30_000 });
    groupPostId = page.url().match(/\/live\/([0-9a-f-]+)/)?.[1] ?? '';
    const body = await (await api.get(`/api/group-posts/${groupPostId}/scorecard`)).json();
    const stored = body.scorecard?.golf_data?.hole_data as Array<{ hole: number; par: number }>;
    expect(stored).toHaveLength(18);
    expect(stored.find(h => h.hole === 2)?.par).toBe(5);
    // Nov 19 2026 (Tom: the posted card showed no yardages): the full scorecard
    // draws the round's yardage on each nine, with its sum.
    await page.waitForTimeout(2500);
    const closeScorer = page.getByRole('button', { name: /^close/i }).last();
    if (await closeScorer.count()) await closeScorer.click();
    await page.getByRole('button', { name: /View Full Scorecard/i }).first().click();
    const tab = page.getByRole('tab', { name: /Full Scorecard/i });
    if (await tab.count()) await tab.first().click();
    const panel = page.locator('#round-panel-scorecard');
    await expect(panel.locator('[data-round-yardage-row]')).toHaveCount(2, { timeout: 15_000 });
    const yards = stored as Array<{ hole: number; yardage?: number }>;
    await expect(panel.locator('[data-round-yardage="2"]')).toHaveText(String(yards.find(h => h.hole === 2)!.yardage));
    const front = yards.filter(h => h.hole <= 9).reduce((n, h) => n + (h.yardage ?? 0), 0);
    await expect(panel.locator('[data-round-yardage-sum]').first()).toHaveText(String(front));
    // The yardage row sits above PAR, and no media row is inside the tables.
    const labels = await panel.locator('table').first().locator('tbody tr td:first-child').allInnerTexts();
    expect(labels.slice(0, 2).map(t => t.trim())).toEqual(['YDS', 'PAR']);
    expect(labels.map(t => t.trim().toLowerCase())).not.toContain('media');
  } finally {
    await cleanup('golf-map-card', [
      () => groupPostId && api.delete(`/api/group-posts/${groupPostId}`),
      () => courseId && admin.from('golf_courses').delete().eq('id', courseId),
      () => api.dispose(),
    ]);
  }
});

// Nov 18 2026 (Tom: guess the card where the map has yardage but no pars): every
// line drawn, no par tagged. The card shows, says its pars are estimated, marks
// each one, and the round keeps the mark. Lines of ~160 / ~365 / ~550 yards.
test('a course with map lines and NO pars: the card is shown with estimated pars, marked, and the round keeps the mark @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const api = await apiAs('state.json');
  const stamp = Date.now();
  const name = `QA Map Estimate Links ${stamp}`;
  let courseId = '';
  let groupPostId = '';
  try {
    const want = [4, 5, 3, 5, 3, 4, 4, 3, 5, 5, 4, 3, 4, 5, 3, 5, 3, 4];
    const span = { 3: 0.0013, 4: 0.003, 5: 0.0045 } as Record<number, number>;
    const holes = want.map((par, i) => ({ hole: i + 1, line: [[45.4 + i * 0.01, -75.7], [45.4 + i * 0.01 + span[par], -75.7]] }));
    const seeded = await admin.from('golf_courses').insert({ external_source: 'qa-e2e', external_id: `mapest-${stamp}`, name, holes_count: 18, lat: 45.43, lng: -75.73, hydrated_at: new Date().toISOString(), hole_geometry: { holes, greens: [], source: 'osm' }, hole_geometry_at: new Date().toISOString() }).select('id').single();
    expect(seeded.error, seeded.error?.message).toBeNull();
    courseId = seeded.data!.id as string;
    const flow = await openGolf(page);
    await next(flow, /Step 2 of 7/);
    await page.getByPlaceholder(/search for a golf course/i).fill('QA Map Estimate Links');
    await page.locator('div.absolute.max-h-60 button', { hasText: name }).first().click({ timeout: 15_000 });
    const show = page.locator('[data-course-show-scorecard]');
    await expect(show).toBeVisible({ timeout: 15_000 });
    await expect(show).toHaveText(/^\s*Scorecard\s*$/); // not "Official"
    await show.click();
    const note = page.locator('[data-course-scorecard-map="estimated"]');
    await expect(note).toBeVisible();
    await expect(note).toContainText('estimated');
    // The note fits the phone's width (no sideways page scroll).
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const parRow = page.locator('[data-course-scorecard-row="par"]').first();
    await expect(parRow.locator('[data-course-scorecard-sum="total"]')).toHaveText('72');
    await expect(parRow.locator('td', { hasText: '*' })).toHaveCount(18);
    await next(flow, /Step 3 of 7/);
    await next(flow, /Step 4 of 7/);
    await next(flow, /Step 5 of 7/);
    await next(flow, /Step 6 of 7/);
    await next(flow, /Step 7 of 7/);
    await flow.locator('[data-step-finish]').click();
    await page.waitForURL(/\/live\/[0-9a-f-]+/, { timeout: 30_000 });
    groupPostId = page.url().match(/\/live\/([0-9a-f-]+)/)?.[1] ?? '';
    const body = await (await api.get(`/api/group-posts/${groupPostId}/scorecard`)).json();
    const stored = body.scorecard?.golf_data?.hole_data as Array<{ hole: number; par: number; parEstimated?: boolean }>;
    expect(stored).toHaveLength(18);
    expect(stored.map(h => h.par)).toEqual(want);
    expect(stored.every(h => h.parEstimated === true)).toBe(true);
    // Nov 19 2026: the saved round keeps saying so. The scorer's hole header…
    // (the page's own hole chip says it too, behind the open scorer)
    await expect(page.locator(':text("Par 4 (est.)"):visible').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-live-par-estimated]')).toHaveCount(1);
    // …and, once the card is in, the posted scorecard's par row.
    const me = body.scorecard.group_post.creator_id as string;
    const filled = await api.post('/api/golf/participant-scores', {
      data: { group_post_id: groupPostId, already_played: true, participant_scores: [{ participant_id: me, hole_scores: want.map((par, i) => ({ hole_number: i + 1, strokes: par })) }] },
    });
    expect(filled.ok(), await readErrorBody(filled)).toBe(true);
    await page.goto(`/live/${groupPostId}`);
    await page.getByRole('button', { name: /View Full Scorecard/i }).first().click({ timeout: 30_000 });
    const tab = page.getByRole('tab', { name: /Full Scorecard/i });
    if (await tab.count()) await tab.first().click();
    const estPanel = page.locator('#round-panel-scorecard');
    await expect(estPanel.locator('[data-round-par-estimated]')).toHaveCount(2, { timeout: 15_000 });
    await expect(estPanel.locator('[data-round-par-estimated]').first()).toHaveText('PAR (est.)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  } finally {
    await cleanup('golf-map-estimate', [
      () => groupPostId && admin.from('golf_rounds').delete().eq('group_post_id', groupPostId),
      () => groupPostId && api.delete(`/api/group-posts/${groupPostId}`),
      () => courseId && admin.from('golf_courses').delete().eq('id', courseId),
      () => api.dispose(),
    ]);
  }
});

// Nov 19 2026 (Tom: split the club into its courses). The lookup found that the
// provider lists this club as two courses: the catalog holds one row each and
// the composer asks which one, with the question a split club always asked.
// The provider is not reachable from a test, so the `?sheet=1` answer is the
// one thing stubbed; the club, its two courses and their cards are real rows.
test('a club the lookup finds to be two courses: the golfer is asked which, and the chosen course\'s card is used @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const stamp = Date.now();
  const clubName = `QA Split Glen Golf Club ${stamp}`;
  const holeData = (pars: number[]) => pars.map((par, i) => ({ number: i + 1, par, yardage: { white: 300 + i * 10 }, handicap: i + 1 }));
  const NORTH = [4, 5, 3, 4, 4, 5, 3, 4, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4];
  const SOUTH = [5, 4, 4, 3, 4, 4, 5, 3, 4, 4, 3, 5, 4, 4, 4, 5, 3, 4];
  const base = { lat: 45.61, lng: -75.61, city: 'Testville', region_code: 'ON', country_code: 'CA', hydrated_at: new Date().toISOString() };
  let clubId = '';
  const courseIds: string[] = [];
  try {
    const club = await admin.from('golf_clubs').insert({ name: clubName, ...{ lat: base.lat, lng: base.lng } }).select('id').single();
    expect(club.error, club.error?.message).toBeNull();
    clubId = club.data!.id as string;
    // The club's own row is NOT linked yet: the answer to the lookup is what tells the composer.
    const rows = await admin.from('golf_courses').insert([
      { external_source: 'qa-e2e', external_id: `split-club-${stamp}`, name: clubName, ...base },
      { external_source: 'qa-e2e', external_id: `split-north-${stamp}`, name: `${clubName} (North)`, club_id: clubId, club_name: clubName, section_name: 'North', section_kind: 'course_18', holes_count: 18, total_par: 72, hole_data: holeData(NORTH), ...base },
      { external_source: 'qa-e2e', external_id: `split-south-${stamp}`, name: `${clubName} (South)`, club_id: clubId, club_name: clubName, section_name: 'South', section_kind: 'unspecified', ...base, hole_data: holeData(SOUTH), holes_count: 18, total_par: 72 },
    ]).select('id, name');
    expect(rows.error, rows.error?.message).toBeNull();
    for (const r of rows.data!) courseIds.push(r.id as string);
    const idOf = (suffix: string) => rows.data!.find(r => (r.name as string).endsWith(suffix))!.id as string;
    const clubRowId = rows.data!.find(r => r.name === clubName)!.id as string;
    let asked = 0;
    await page.route(url => url.pathname === '/api/golf/courses' && url.searchParams.get('sheet') === '1' && url.searchParams.get('id') === clubRowId, async route => {
      asked += 1;
      await route.fulfill({
        status: 200, contentType: 'application/json', headers: { 'Cache-Control': 'private, no-store' },
        body: JSON.stringify({
          found: false, outcome: 'split',
          course: { id: clubRowId, name: clubName, holes: [], courseRating: {}, slopeRating: {}, clubId },
          club: { id: clubId, name: clubName },
          siblings: [{ id: idOf('(North)'), name: `${clubName} (North)`, sectionName: 'North', sectionKind: 'course_18', holesCount: 18 }, { id: idOf('(South)'), name: `${clubName} (South)`, sectionName: 'South', sectionKind: 'unspecified' }],
        }),
      });
    });

    const flow = await openGolf(page);
    await next(flow, /Step 2 of 7/);
    await page.getByPlaceholder(/search for a golf course/i).fill(`QA Split Glen Golf Club ${stamp}`);
    await page.locator('div.absolute.max-h-60 button', { hasText: clubName }).filter({ hasNotText: '(' }).first().click({ timeout: 15_000 });

    // The question, with both courses; no "nothing found" line beside it.
    const chooser = page.locator('[data-club-section-chooser]');
    await expect(chooser).toBeVisible({ timeout: 15_000 });
    expect(asked).toBe(1);
    await expect(chooser).toContainText(`${clubName} has more than one course`);
    await expect(chooser.locator('[data-club-section-option]')).toHaveCount(2);
    // A course known to be an 18 says so; one not yet known says nothing.
    await expect(chooser.locator(`[data-club-section-option="${idOf('(North)')}"]`)).toContainText('18 holes');
    await expect(chooser.locator(`[data-club-section-option="${idOf('(South)')}"]`)).toHaveText(/^\s*South\s*$/);
    await expect(page.locator('[data-course-sheet-none]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    for (const option of await chooser.locator('[data-club-section-option]').all()) {
      const box = (await option.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    // Choosing South: that course is the selection, its own card is the round's, and the question is gone.
    await chooser.locator(`[data-club-section-option="${idOf('(South)')}"]`).click();
    await expect(chooser).toHaveCount(0, { timeout: 15_000 });
    const show = page.locator('[data-course-show-scorecard]');
    await expect(show).toBeVisible({ timeout: 15_000 });
    await show.click();
    const parRow = page.locator('[data-course-scorecard-row="par"]').first();
    await expect(parRow.locator('[data-course-scorecard-sum="total"]')).toHaveText('72');
    const shown = (await parRow.locator('td').allInnerTexts()).map(t => t.trim()).filter(t => /^[3-6]$/.test(t)).slice(0, 9).map(Number);
    expect(shown).toEqual(SOUTH.slice(0, 9));
  } finally {
    await cleanup('golf-club-split', [
      () => courseIds.length && admin.from('golf_courses').delete().in('id', courseIds),
      () => clubId && admin.from('golf_clubs').delete().eq('id', clubId),
    ]);
  }
});
