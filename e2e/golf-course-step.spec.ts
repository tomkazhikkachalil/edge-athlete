import { test, expect, type Page, type Locator } from './helpers/test';
import { adminClient, apiAs } from './helpers/qa-user';
import { cleanup } from './helpers/cleanup';
import { goLive } from './helpers/go-live';

// The golf round's course step in the mechanical dialect (Tom's visual spec,
// Nov 23 2026): the SEARCH (a slot, the Near me key, the lists) swaps in
// place for the PICKED course (the plate, the dials, the Men | Women switch,
// the tee table, the utility row). The visuals are wired to the round: the
// tee row that is tapped is the tee the round saves, with that tee's rating
// and slope; the dials read the same numbers; a course played once comes back
// under RECENT; a course typed by hand asks for its rating in two slots.
// Self-seeded course; the round it starts is removed in the finally.

const TEES: Record<string, [number, number, number]> = {
  black: [73.9, 138, 400],
  blue: [71.7, 131, 370],
  white: [69.8, 126, 345],
  'white (f)': [75.1, 133, 345],
  'red (f)': [71.9, 124, 300],
};

async function openCourseStep(page: Page): Promise<Locator> {
  await page.goto('/feed?create=1&sport=golf');
  const flow = page.locator('[data-step-flow="golf-round"]');
  await expect(flow).toBeVisible({ timeout: 20_000 });
  await flow.locator('[data-step-next]').click();
  await expect(flow).toHaveAttribute('data-step', 'course');
  return flow;
}
const readout = (page: Page, dial: string) => page.locator(`[data-dial="${dial}"] [data-dial-readout]`);

for (const tag of ['', ' @mobile']) {
  test(`the course step: search → the picked course; Men | Women, the tee table, the dials, Recent, a typed course${tag}`, async ({ page }) => {
    test.setTimeout(120_000);
    const admin = adminClient();
    const api = await apiAs('state.json');
    const stamp = Date.now();
    const name = `QA Dial Glen ${stamp}`;
    let courseId = '';
    let groupPostId = '';
    try {
      const seeded = await admin.from('golf_courses').insert({
        external_source: 'qa-e2e',
        external_id: `dial-${stamp}`,
        name,
        city: 'Ottawa',
        region: 'Ontario',
        country: 'Canada',
        total_par: 72,
        holes_count: 18,
        hydrated_at: new Date().toISOString(),
        course_rating: Object.fromEntries(Object.entries(TEES).map(([k, v]) => [k, v[0]])),
        slope_rating: Object.fromEntries(Object.entries(TEES).map(([k, v]) => [k, v[1]])),
        hole_data: Array.from({ length: 18 }, (_, i) => ({
          number: i + 1,
          par: 4,
          handicap: i + 1,
          yardage: Object.fromEntries(Object.entries(TEES).map(([k, v]) => [k, v[2]])),
        })),
      }).select('id').single();
      expect(seeded.error, seeded.error?.message).toBeNull();
      courseId = seeded.data!.id as string;

      // ── The search view ───────────────────────────────────────────────────
      let flow = await openCourseStep(page);
      const search = page.getByPlaceholder(/search courses/i);
      await expect(page.locator('[data-course-view="search"]')).toBeVisible();
      await expect(page.locator('[data-course-near-me]')).toHaveAttribute('aria-pressed', 'false');
      await expect(flow.locator('[data-step-next]')).toBeDisabled();
      // 48 px slot and key, side by side.
      const slotBox = (await search.locator('xpath=..').boundingBox())!;
      const keyBox = (await page.locator('[data-course-near-me]').boundingBox())!;
      expect(Math.round(slotBox.height)).toBe(48);
      expect(Math.round(keyBox.width)).toBe(48);
      expect(Math.round(keyBox.height)).toBe(48);
      expect(Math.abs(slotBox.y - keyBox.y)).toBeLessThanOrEqual(1);

      // A name nothing matches: said plainly, with the way on.
      await search.fill(`Zzqx Nowhere ${stamp}`);
      await expect(page.locator('[data-course-none]')).toHaveText('No course found', { timeout: 15_000 });
      await expect(page.locator('[data-course-add-manually]')).toBeVisible();
      await expect(flow.locator('[data-step-next]')).toBeEnabled(); // a typed name is a course, as before

      // The seeded course, in the list in the flow.
      await search.fill('QA Dial Glen');
      const row = page.locator('[data-course-results] button', { hasText: name }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row).toContainText('Ottawa');
      expect(Math.round((await row.boundingBox())!.height)).toBe(56);
      await row.click();

      // ── The picked course, swapped in place ───────────────────────────────
      await expect(page.locator('[data-course-view="selected"]')).toBeVisible();
      await expect(page.locator('[data-course-view="search"]')).toHaveCount(0);
      await expect(page.locator('[data-course-chosen]')).toContainText(name);
      await expect(page.locator('[data-course-chosen]')).toContainText('Ottawa');
      await expect(page.locator('[data-dial-holes]')).toHaveText(/18 holes/i);
      await expect(page.locator('[data-dial-par]')).toHaveText(/Par 72/i);
      // No tee yet: the needles rest, the readouts are dashes.
      for (const dial of ['yards', 'rating', 'slope']) {
        await expect(readout(page, dial)).toHaveText('—');
        await expect(page.locator(`[data-dial="${dial}"]`)).toHaveAttribute('data-dial-angle', '-135');
      }
      // Men | Women: the table lists one side at a time, without "(F)".
      const men = page.getByRole('button', { name: 'Men', exact: true });
      const women = page.getByRole('button', { name: 'Women', exact: true });
      await expect(men).toHaveAttribute('aria-pressed', 'true');
      const rows = page.locator('[data-tee-table] [data-tee-row]');
      await expect(rows).toHaveCount(3);
      await expect(rows.nth(0)).toHaveText(/Black\s*7,200\s*73\.9 \/ 138/);
      await women.click();
      await expect(women).toHaveAttribute('aria-pressed', 'true');
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toHaveText(/White\s*6,210\s*75\.1 \/ 133/);
      await expect(page.locator('[data-tee-table]')).not.toContainText('(F)');

      // A tee row's tap is the round's tee: the dials follow it.
      const redF = page.locator('[data-tee-row="red (f)"]');
      await redF.click();
      await expect(redF).toHaveAttribute('aria-pressed', 'true');
      await expect(readout(page, 'yards')).toHaveText('5,400');
      await expect(readout(page, 'rating')).toHaveText('71.9');
      await expect(readout(page, 'slope')).toHaveText('124');
      // 5,400 on 5,000–7,200 → -135 + 270 × 400 / 2200 ≈ -86.
      await expect(page.locator('[data-dial="yards"]')).toHaveAttribute('data-dial-angle', '-86');
      // The card has the numbers: nothing asks for them.
      await expect(page.locator('[data-course-rating-entry]')).toHaveCount(0);
      // The utility row: 44 px buttons; the scorecard opens under it and widens the dialog on a desktop.
      const card = page.locator('[data-course-show-scorecard]');
      await expect(card).toBeVisible({ timeout: 15_000 });
      expect(Math.round((await card.boundingBox())!.height)).toBe(44);
      await card.click();
      await expect(page.locator('[data-course-scorecard-row="par"] [data-course-scorecard-sum="total"]').first()).toHaveText('72');
      const vw = page.viewportSize()!.width;
      if (vw >= 960) {
        await expect(page.locator('[data-composer-frame]')).toHaveAttribute('data-composer-frame', 'full');
        // The whole eighteen fits: the table does not scroll sideways.
        await page.waitForTimeout(500);
        const fits = await page.locator('[data-course-scorecard-table]').first().evaluate(el => el.scrollWidth <= el.clientWidth + 1);
        expect(fits, 'the scorecard fits the dialog on a desktop').toBe(true);
      }
      await card.click();
      await expect(page.locator('[data-course-scorecard]')).toHaveCount(0);
      if (vw >= 960) await expect(page.locator('[data-composer-frame]')).toHaveAttribute('data-composer-frame', 'wide');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

      // ── The round saves what the screen showed ────────────────────────────
      for (const step of ['format', 'conditions', 'players', 'finish']) {
        await flow.locator('[data-step-next]').click();
        await expect(flow).toHaveAttribute('data-step', step);
      }
      await expect(flow.locator('[data-round-summary-row="tee"]')).toContainText('Red (F) · 5,400 yds · 71.9 / 124');
      // An outdoor round has no putting rule to state.
      await expect(flow.locator('[data-round-summary-row="putting"]')).toHaveCount(0);
      await goLive(flow);
      await page.waitForURL(/\/live\/[0-9a-f-]+/, { timeout: 30_000 });
      groupPostId = page.url().match(/\/live\/([0-9a-f-]+)/)?.[1] ?? '';
      expect(groupPostId).not.toBe('');
      const saved = await admin.from('golf_scorecard_data').select('course_id, course_name, tee_color, course_rating, slope_rating').eq('group_post_id', groupPostId).single();
      expect(saved.error, saved.error?.message).toBeNull();
      expect(saved.data!.course_id).toBe(courseId);
      expect(saved.data!.course_name).toBe(name);
      expect(saved.data!.tee_color).toBe('red (f)');
      expect(Number(saved.data!.course_rating)).toBe(71.9);
      expect(Number(saved.data!.slope_rating)).toBe(124);

      // ── Recent: the course just played is offered before any typing ──────
      // The round is live with no scores, so the app asks to pick it up when
      // the feed opens again: "Not now" (the round stays, as it should).
      await page.addLocatorHandler(page.getByRole('heading', { name: 'Pick up where you left off?' }), async () => {
        await page.getByRole('button', { name: 'Not now' }).click();
      });
      flow = await openCourseStep(page);
      const recent = page.locator('[data-course-recent]');
      await expect(recent).toBeVisible({ timeout: 15_000 });
      await expect(recent.locator('button').first()).toContainText(name);
      await recent.locator('button', { hasText: name }).first().click();
      await expect(page.locator('[data-course-chosen]')).toContainText(name);

      // ── "Change" returns to the search; a typed course asks for its rating ─
      await page.locator('[data-course-change]').click();
      await expect(page.locator('[data-course-view="search"]')).toBeVisible();
      await expect(page.getByPlaceholder(/search courses/i)).toHaveValue('');
      await page.getByPlaceholder(/search courses/i).fill(`QA Home Track ${stamp}`);
      await page.locator('[data-course-add-manually]').click();
      await expect(page.locator('[data-course-chosen]')).toContainText(`QA Home Track ${stamp}`);
      await expect(page.locator('[data-course-chosen]')).toContainText('Custom course');
      const entry = page.locator('[data-course-rating-entry]');
      await expect(entry).toBeVisible();
      await entry.locator('input').nth(0).fill('70.4');
      await entry.locator('input').nth(1).fill('122');
      await expect(readout(page, 'rating')).toHaveText('70.4');
      await expect(readout(page, 'slope')).toHaveText('122');
      // A typed course keeps the classic five colours and its par table.
      await expect(page.locator('[data-tee-table] [data-tee-row]')).toHaveCount(5);
      await expect(page.getByRole('heading', { name: /Course Par & Yardage/ })).toBeVisible();
      // Its plate's Change keeps the typed name in the slot to be corrected.
      await page.locator('[data-course-change]').click();
      await expect(page.getByPlaceholder(/search courses/i)).toHaveValue(`QA Home Track ${stamp}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    } finally {
      await cleanup('golf-course-step', [
        () => groupPostId && api.delete(`/api/group-posts/${groupPostId}`),
        () => groupPostId && admin.from('golf_rounds').delete().eq('group_post_id', groupPostId),
        () => courseId && admin.from('golf_courses').delete().eq('id', courseId),
        () => api.dispose(),
      ]);
    }
  });
}

// An INDOOR round's course step (Tom's indoor course spec, Nov 27 2026): the
// SAME tee table as outdoors, without the Men | Women switch (the men's
// boxes), Next waits for a tee, the dials fill from it, the strip says only
// Par, the utility row has no Website — and the putting rule: a three-way
// switch, the gimme distance slider (keys and a drag), an info key that
// swaps the readout in place. The round saves the tee and the rule.
/** Drag the slider's key to `fraction` of the track (0 = start, 1 = end). */
async function dragRange(page: Page, slider: Locator, fraction: number) {
  const box = (await slider.boundingBox())!;
  const key = (await slider.locator('[data-range-key]').boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(key.x + key.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 13 + (box.width - 26) * fraction, y, { steps: 10 });
  await page.mouse.up();
}

for (const tag of ['', ' @mobile']) {
  test(`the course step, indoor: the tee table, Next waits for a tee, the putting rule is saved${tag}`, async ({ page }) => {
    test.setTimeout(120_000);
    const admin = adminClient();
    const api = await apiAs('state.json');
    const stamp = Date.now();
    const name = `QA Sim Glen ${stamp}`;
    let courseId = '';
    let groupPostId = '';
    try {
      const seeded = await admin.from('golf_courses').insert({
        external_source: 'qa-e2e',
        external_id: `sim-${stamp}`,
        name,
        city: 'Ottawa',
        region: 'Ontario',
        country: 'Canada',
        website: 'https://example.com',
        total_par: 72,
        holes_count: 18,
        hydrated_at: new Date().toISOString(),
        course_rating: Object.fromEntries(Object.entries(TEES).map(([k, v]) => [k, v[0]])),
        slope_rating: Object.fromEntries(Object.entries(TEES).map(([k, v]) => [k, v[1]])),
        hole_data: Array.from({ length: 18 }, (_, i) => ({
          number: i + 1,
          par: 4,
          handicap: i + 1,
          yardage: Object.fromEntries(Object.entries(TEES).map(([k, v]) => [k, v[2]])),
        })),
      }).select('id').single();
      expect(seeded.error, seeded.error?.message).toBeNull();
      courseId = seeded.data!.id as string;

      await page.goto('/feed?create=1&sport=golf');
      const flow = page.locator('[data-step-flow="golf-round"]');
      await expect(flow).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Indoor' }).click();
      await expect(flow.locator('[data-step-header]')).toHaveText(/Step 1 of 5 · Round type/);
      await expect(page.getByText('Indoor rounds skip the playing conditions.')).toBeVisible();
      await flow.locator('[data-step-next]').click();
      await expect(flow).toHaveAttribute('data-step', 'course');

      // A name typed but not added: the tee list is not on screen yet.
      const search = page.getByPlaceholder(/search courses/i);
      await search.fill('QA Sim Glen');
      await expect(flow.locator('[data-step-next]')).toBeDisabled();
      await expect(flow.locator('[data-step-refusal]')).toHaveText('Pick a course, or add the one you typed');
      const row = page.locator('[data-course-results] button', { hasText: name }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.click();
      await expect(page.locator('[data-course-chosen]')).toContainText(name);

      // ── The step: Par only, the men's boxes, no switch, no Website ────────
      await expect(page.locator('[data-dial-holes]')).toHaveCount(0);
      await expect(page.locator('[data-dial-par]')).toHaveText(/Par 72/i);
      await expect(page.getByRole('button', { name: 'Men', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Women', exact: true })).toHaveCount(0);
      const rows = page.locator('[data-tee-table] [data-tee-row]');
      await expect(rows).toHaveCount(3);
      await expect(rows.nth(0)).toHaveText(/Black\s*7,200\s*73\.9 \/ 138/);
      await expect(page.locator('[data-tee-row="red (f)"]')).toHaveCount(0);
      await expect(page.locator('[data-course-show-scorecard]')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-course-website]')).toHaveCount(0);

      // No tee: the dials rest, nothing is asked to be typed, Next waits.
      for (const dial of ['yards', 'rating', 'slope']) await expect(readout(page, dial)).toHaveText('—');
      await expect(page.locator('[data-course-rating-entry]')).toHaveCount(0);
      await expect(flow.locator('[data-step-next]')).toBeDisabled();
      await expect(flow.locator('[data-step-refusal]')).toHaveText('Pick a tee first');
      const blue = page.locator('[data-tee-row="blue"]');
      await blue.click();
      await expect(blue).toHaveAttribute('aria-pressed', 'true');
      await expect(readout(page, 'yards')).toHaveText('6,660');
      await expect(readout(page, 'rating')).toHaveText('71.7');
      await expect(readout(page, 'slope')).toHaveText('131');
      await expect(flow.locator('[data-step-next]')).toBeEnabled();
      // Letting the tee go takes Next away again.
      await blue.click();
      await expect(flow.locator('[data-step-next]')).toBeDisabled();
      await blue.click();
      await expect(flow.locator('[data-step-next]')).toBeEnabled();

      // ── The putting rule ──────────────────────────────────────────────────
      const rule = page.locator('[data-putting-rule]');
      const readoutBox = page.locator('[data-putting-readout]');
      const key = (label: string) => rule.getByRole('button', { name: label, exact: true });
      await expect(rule).toHaveAttribute('data-putting-rule', 'putt_out');
      await expect(key('Putt out')).toHaveAttribute('aria-pressed', 'true');
      await expect(readoutBox).toHaveText('Every putt counts');
      // The order on the page: dials, tees, putting rule, utility row (a
      // phone); from 640 px the tees are the right-hand column.
      const ruleBox = (await rule.boundingBox())!;
      const utilBox = (await page.locator('[data-course-show-scorecard]').boundingBox())!;
      const dialBox = (await page.locator('[data-dial-cluster]').boundingBox())!;
      const teeBox = (await page.locator('[data-tee-table]').boundingBox())!;
      expect(ruleBox.y).toBeGreaterThan(dialBox.y + dialBox.height - 1);
      expect(utilBox.y).toBeGreaterThan(ruleBox.y + ruleBox.height - 1);
      if (page.viewportSize()!.width >= 640) expect(teeBox.x).toBeGreaterThan(dialBox.x + dialBox.width - 1);
      else expect(ruleBox.y).toBeGreaterThan(teeBox.y + teeBox.height - 1);
      // Three equal 44 px keys.
      const widths: number[] = [];
      for (const label of ['Putt out', 'Gimme', 'Auto 2']) {
        const b = (await key(label).boundingBox())!;
        expect(Math.round(b.height)).toBe(44);
        widths.push(b.width);
      }
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
      // The readout is one height in every state, so nothing below moves.
      // (Measured from the rule itself: the step's body may scroll under a click.)
      const below = async () => Math.round((await page.locator('[data-course-show-scorecard]').boundingBox())!.y - (await rule.boundingBox())!.y);
      const restY = await below();
      const height = async () => Math.round((await readoutBox.boundingBox())!.height);
      expect(await height()).toBe(52);

      // Gimme: 6 ft by default; keys, then a drag.
      await key('Gimme').click();
      await expect(rule).toHaveAttribute('data-putting-rule', 'gimme');
      const slider = page.getByRole('slider', { name: 'Gimme distance in feet' });
      await expect(slider).toHaveAttribute('aria-valuenow', '6');
      await expect(slider).toHaveAttribute('aria-valuemin', '1');
      await expect(slider).toHaveAttribute('aria-valuemax', '15');
      await expect(page.locator('[data-putting-feet]')).toHaveText(/6\s*ft/);
      expect(Math.round((await slider.boundingBox())!.height)).toBe(44);
      expect(await height()).toBe(52);
      expect(await below()).toBe(restY);
      await slider.focus();
      await slider.press('ArrowRight');
      await slider.press('ArrowRight');
      await expect(slider).toHaveAttribute('aria-valuenow', '8');
      await slider.press('ArrowLeft');
      await expect(slider).toHaveAttribute('aria-valuenow', '7');
      await slider.press('End');
      await expect(slider).toHaveAttribute('aria-valuenow', '15');
      await slider.press('ArrowRight');
      await expect(slider).toHaveAttribute('aria-valuenow', '15');
      await slider.press('Home');
      await expect(slider).toHaveAttribute('aria-valuenow', '1');
      await dragRange(page, slider, 1);
      await expect(slider).toHaveAttribute('aria-valuenow', '15');
      await dragRange(page, slider, 0.5);
      await expect(slider).toHaveAttribute('aria-valuenow', '8');
      await expect(page.locator('[data-putting-feet]')).toHaveText(/8\s*ft/);
      // The key never leaves its track.
      await dragRange(page, slider, 0);
      const s = (await slider.boundingBox())!;
      const k = (await slider.locator('[data-range-key]').boundingBox())!;
      expect(k.x).toBeGreaterThanOrEqual(s.x - 1);
      await slider.focus();
      for (let i = 0; i < 8; i += 1) await slider.press('ArrowUp');
      await expect(slider).toHaveAttribute('aria-valuenow', '9');

      // The info key swaps the readout for one line, in place; again swaps back.
      const info = rule.getByRole('button', { name: 'About putting' });
      await info.click();
      await expect(info).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('[data-putting-info]')).toHaveText('A ball that stops inside 9 ft is holed for 1 putt.');
      await expect(slider).toHaveCount(0);
      expect(await height()).toBe(52);
      expect(await below()).toBe(restY);
      await key('Auto 2').click();
      await expect(page.locator('[data-putting-info]')).toHaveText('Any ball on the green is holed for 2 putts.');
      await key('Putt out').click();
      await expect(page.locator('[data-putting-info]')).toHaveText('Every putt is played and counted.');
      await info.click();
      await expect(page.locator('[data-putting-info]')).toHaveCount(0);
      await key('Auto 2').click();
      await expect(readoutBox).toHaveText(/On the green\s*\+2\s*Putts/);
      expect(await height()).toBe(52);
      expect(await below()).toBe(restY);
      // Back to gimme: the distance was kept.
      await key('Gimme').click();
      await expect(slider).toHaveAttribute('aria-valuenow', '9');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

      // ── The round saves the tee and the rule ──────────────────────────────
      for (const step of ['format', 'players', 'finish']) {
        await flow.locator('[data-step-next]').click();
        await expect(flow).toHaveAttribute('data-step', step);
      }
      await expect(flow.locator('[data-round-summary-row="round-type"]')).toContainText('Indoor');
      await expect(flow.locator('[data-round-summary-row="tee"]')).toContainText('Blue · 6,660 yds · 71.7 / 131');
      // The Start step states the putting rule in force.
      await expect(flow.locator('[data-round-summary-row="putting"]')).toContainText('Putting');
      await expect(flow.locator('[data-round-summary-row="putting"]')).toContainText('Gimme · inside 9 ft, 1 putt');
      await goLive(flow);
      await page.waitForURL(/\/live\/[0-9a-f-]+/, { timeout: 30_000 });
      groupPostId = page.url().match(/\/live\/([0-9a-f-]+)/)?.[1] ?? '';
      expect(groupPostId).not.toBe('');
      const saved = await admin.from('golf_scorecard_data').select('round_type, tee_color, course_rating, slope_rating, putting_rule, gimme_feet').eq('group_post_id', groupPostId).single();
      expect(saved.error, saved.error?.message).toBeNull();
      expect(saved.data!.round_type).toBe('indoor');
      expect(saved.data!.tee_color).toBe('blue');
      expect(Number(saved.data!.course_rating)).toBe(71.7);
      expect(Number(saved.data!.slope_rating)).toBe(131);
      expect(saved.data!.putting_rule).toBe('gimme');
      expect(saved.data!.gimme_feet).toBe(9);
    } finally {
      await cleanup('golf-course-step-indoor', [
        () => groupPostId && api.delete(`/api/group-posts/${groupPostId}`),
        () => groupPostId && admin.from('golf_rounds').delete().eq('group_post_id', groupPostId),
        () => courseId && admin.from('golf_courses').delete().eq('id', courseId),
        () => api.dispose(),
      ]);
    }
  });
}

// The write gate (322): an outdoor round never carries a rule; an indoor
// round's rule is checked, not repaired; a typed indoor course keeps the
// classic colours and the rating slots.
test('the putting rule: outdoor saves none, a wrong value is refused; a typed indoor course lists the classic tees', async ({ page }) => {
  const admin = adminClient();
  const api = await apiAs('state.json');
  const created: string[] = [];
  const body = (golf: Record<string, unknown>) => ({
    type: 'golf_round',
    title: 'QA putting rule',
    date: new Date().toISOString().slice(0, 10),
    visibility: 'public',
    participant_ids: [],
    already_played: true,
    golf_data: { course_name: `QA Putting ${Date.now()}`, holes_played: 18, ...golf },
  });
  try {
    const outdoor = await api.post('/api/group-posts', { data: body({ round_type: 'outdoor', putting_rule: 'gimme', gimme_feet: 6 }) });
    expect(outdoor.ok(), await outdoor.text()).toBe(true);
    const outdoorId = ((await outdoor.json()) as { group_post?: { id?: string } }).group_post?.id ?? '';
    created.push(outdoorId);
    const row = await admin.from('golf_scorecard_data').select('putting_rule, gimme_feet').eq('group_post_id', outdoorId).single();
    expect(row.data).toEqual({ putting_rule: null, gimme_feet: null });

    for (const bad of [{ putting_rule: 'two_putt' }, { putting_rule: 'gimme' }, { putting_rule: 'gimme', gimme_feet: 16 }, { putting_rule: 'gimme', gimme_feet: 0 }]) {
      const res = await api.post('/api/group-posts', { data: body({ round_type: 'indoor', ...bad }) });
      expect(res.status(), JSON.stringify(bad)).toBe(400);
    }
    const auto = await api.post('/api/group-posts', { data: body({ round_type: 'indoor', putting_rule: 'auto_2', gimme_feet: 6 }) });
    expect(auto.ok(), await auto.text()).toBe(true);
    const autoId = ((await auto.json()) as { group_post?: { id?: string } }).group_post?.id ?? '';
    created.push(autoId);
    const autoRow = await admin.from('golf_scorecard_data').select('putting_rule, gimme_feet').eq('group_post_id', autoId).single();
    expect(autoRow.data).toEqual({ putting_rule: 'auto_2', gimme_feet: null });

    // A typed course, indoors: the five classic colours, the two slots.
    await page.goto('/feed?create=1&sport=golf');
    const flow = page.locator('[data-step-flow="golf-round"]');
    await expect(flow).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Indoor' }).click();
    await flow.locator('[data-step-next]').click();
    await page.getByPlaceholder(/search courses/i).fill(`QA Indoor Bay ${Date.now()}`);
    await page.locator('[data-course-add-manually]').click();
    await expect(page.locator('[data-course-chosen]')).toContainText('QA Indoor Bay');
    await expect(page.locator('[data-tee-table] [data-tee-row]')).toHaveCount(5);
    await expect(page.locator('[data-course-rating-entry]')).toBeVisible();
    await expect(page.locator('[data-putting-rule]')).toBeVisible();
    await expect(flow.locator('[data-step-next]')).toBeDisabled();
    await page.locator('[data-tee-row="white"]').click();
    await expect(flow.locator('[data-step-next]')).toBeEnabled();
    // Outdoor: no putting rule on the step.
    await flow.locator('[data-step-back]').click();
    await page.getByRole('button', { name: 'Outdoor' }).click();
    await flow.locator('[data-step-next]').click();
    await expect(page.locator('[data-tee-table]')).toBeVisible();
    await expect(page.locator('[data-putting-rule]')).toHaveCount(0);
    await expect(page.locator('[data-dial-holes]')).toBeVisible();
  } finally {
    await cleanup('golf-putting-rule', [
      ...created.filter(Boolean).map(id => () => api.delete(`/api/group-posts/${id}`)),
      ...created.filter(Boolean).map(id => () => admin.from('golf_rounds').delete().eq('group_post_id', id)),
      () => api.dispose(),
    ]);
  }
});
