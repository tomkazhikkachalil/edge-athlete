import { test, expect, type Page } from './helpers/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';
import { cleanup } from './helpers/cleanup';
import { expectScorerClosed, expectScorerOnHole, mapPreview, nextHole, previousHole, scoreCard, strokesDial, typeStrokes } from './helpers/score-card';

// The live scoring card (Tom's live-round spec, Nov 25 2026). The visuals
// are wired to the round: what the card shows is what the round saves.
// Self-seeded course (pars 4 / 3 / 5 by hole, a line per hole) and a round
// of two players; the round is purged in the finally.

type LatLng = [number, number];
type Hole = { hole_number: number; strokes: number; putts: number | null; fairway_hit: boolean | null; green_in_regulation: boolean | null; penalties: string[] | null; penalty_strokes: number[] | null };
const parOf = (hole: number) => ((hole - 1) % 3 === 1 ? 3 : (hole - 1) % 3 === 2 ? 5 : 4);

for (const tag of ['', ' @mobile']) {
  test(`the scoring card: defaults, the dial, when a hole is recorded, penalties per hole and player, the map preview${tag}`, async ({ page }) => {
    test.setTimeout(240_000);
    const admin = adminClient();
    const me = loadQaUser('user.json');
    const bravo = loadQaUser('user-b.json');
    const api = await apiAs('state.json');
    const stamp = Date.now();
    const holes = Array.from({ length: 18 }, (_, i) => {
      const lat = 45.3 + i * 0.004;
      return { hole: i + 1, par: parOf(i + 1), line: [[lat, -75.7], [lat + 0.0015, -75.6996], [lat + 0.003, -75.699]] as LatLng[] };
    });
    let courseId = '';
    let roundId = '';
    try {
      const seeded = await admin.from('golf_courses').insert({
        external_source: 'qa-e2e', external_id: `card-${stamp}`, name: `QA Card Links ${stamp}`, lat: holes[0].line[0][0], lng: holes[0].line[0][1],
        hole_data: holes.map(h => ({ number: h.hole, par: h.par, yardage: { white: 388, blue: 412 }, handicap: ((h.hole * 7) % 18) + 1 })),
        course_rating: { white: 70.1, blue: 71.9 }, slope_rating: { white: 125, blue: 133 },
        hole_geometry: { holes, source: 'osm', greens: [] }, hole_geometry_at: new Date(stamp - 60_000).toISOString(),
      }).select('id').single();
      expect(seeded.error, seeded.error?.message).toBeNull();
      courseId = seeded.data!.id as string;
      const made = await api.post('/api/group-posts', {
        data: {
          type: 'golf_round', title: `QA Card ${stamp}`, date: new Date().toISOString().split('T')[0], visibility: 'private', participant_ids: [bravo.id],
          golf_data: { course_name: `QA Card Links ${stamp}`, round_type: 'outdoor', holes_played: 18, tee_color: 'white', hole_data: holes.map(h => ({ hole: h.hole, par: h.par, yardage: 388, handicap: ((h.hole * 7) % 18) + 1 })), course_id: courseId },
        },
      });
      expect(made.ok(), await readErrorBody(made)).toBe(true);
      roundId = (await made.json()).group_post.id as string;
      const readCard = async () => ((await (await api.get(`/api/group-posts/${roundId}/scorecard`)).json()).scorecard as {
        group_post: { status: string };
        participants: Array<{ participant: { id: string; profile_id: string }; scores: { hole_scores?: Hole[] } }>;
      });
      const rowId = async (profileId: string) => (await readCard()).participants.find(p => p.participant.profile_id === profileId)!.participant.id;
      const rowA = await rowId(me.id);
      const rowB = await rowId(bravo.id);
      const saved = async (profileId: string, hole: number) => (await readCard()).participants.find(p => p.participant.profile_id === profileId)!.scores.hole_scores?.find(h => h.hole_number === hole) ?? null;

      await page.goto(`/live/${roundId}`);
      const card = scoreCard(page);
      await expectScorerOnHole(page, 1, 30_000);
      const dial = strokesDial(page);
      const key = (n: number) => card.locator(`[data-hole-key="${n}"]`);
      const lamp = (which: 'fir' | 'gir') => card.locator(`[data-stat-lamp="${which}"]`);
      const total = (which: string) => card.locator(`[data-scorer-total="${which}"]`);
      const badge = card.locator('[data-penalty-badge]');

      // ── What is gone (R1 – R7) ────────────────────────────────────────────
      await expect(card.getByText('Your Scores')).toHaveCount(0);
      await expect(card.getByText(/Hole 1 of 18/)).toHaveCount(0);
      await expect(card.locator('[data-scorer-map]')).toHaveCount(0);
      await expect(card.getByRole('button', { name: 'Library', exact: true })).toHaveCount(0);
      await expect(card.getByRole('spinbutton', { name: 'Strokes' })).toHaveCount(0);
      for (const label of ['Optional Stats', 'Jump to Hole', 'Hole 1 media', 'Tee →']) await expect(card.getByText(label)).toHaveCount(0);
      // X1: live is red, and says so.
      await expect(card.locator('[data-scorer-status="live"]')).toHaveText(/live/i);

      // ── A3: the hole opens on par and 2 putts; FIR and GIR off ────────────
      await expect(dial).toHaveAttribute('aria-valuenow', '4');
      await expect(dial).toHaveAttribute('aria-valuemax', '8');
      await expect(card.locator('[data-dial-name]')).toHaveText('Par');
      await expect(card.locator('[data-putts-number]')).toHaveText('2');
      await expect(lamp('fir')).toHaveAttribute('aria-pressed', 'false');
      await expect(lamp('gir')).toHaveAttribute('aria-pressed', 'false');
      // Nothing is recorded yet: no check, "--", 0/18.
      await expect(key(1)).not.toHaveAttribute('data-recorded', '');
      await expect(total('thru')).toHaveText('0/18');
      await expect(total('to-par')).toHaveText('--');
      // X7: "Thru", not "Holes".
      await expect(card.locator('[data-scorer-totals]')).toContainText(/thru/i);
      // A10: Next names the hole.
      await expect(nextHole(page)).toHaveText(/Hole 2/);
      await expect(previousHole(page)).toBeDisabled();

      // ── A4: Next alone records the defaults ───────────────────────────────
      await nextHole(page).click();
      await expectScorerOnHole(page, 2);
      await expect.poll(async () => (await saved(me.id, 1))?.strokes, { timeout: 15_000 }).toBe(4);
      expect((await saved(me.id, 1))?.putts).toBe(2);
      await expect(key(1)).toHaveAttribute('data-recorded', '');
      await expect(key(1).locator('[data-hole-key-check]')).toBeVisible();
      await expect(total('thru')).toHaveText('1/18');
      await expect(total('to-par')).toHaveText('E');

      // ── A2: the dial follows the hole (a par 3: 0 to 6) ───────────────────
      await expect(dial).toHaveAttribute('aria-valuenow', '3');
      await expect(dial).toHaveAttribute('aria-valuemax', '6');
      await expect(card.locator('[data-dial-tick]')).toHaveCount(6);

      // ── A4: a hole only LOOKED at is not recorded ─────────────────────────
      await key(5).click();
      await expectScorerOnHole(page, 5);
      await previousHole(page).click();
      await expectScorerOnHole(page, 4);
      await key(2).click();
      await expectScorerOnHole(page, 2);
      for (const n of [2, 4, 5]) {
        await expect(key(n)).not.toHaveAttribute('data-recorded', '');
        expect(await saved(me.id, n), `hole ${n} was only looked at`).toBeNull();
      }
      await expect(total('thru')).toHaveText('1/18');

      // ── A1: three ways to set the strokes ─────────────────────────────────
      // Plus and minus.
      await card.locator('[data-strokes-plus]').click();
      await expect(dial).toHaveAttribute('aria-valuenow', '4');
      await expect(card.locator('[data-dial-name]')).toHaveText('Bogey');
      // …a change records the hole at once (A4): the check is there before Next.
      await expect(key(2)).toHaveAttribute('data-recorded', '');
      await expect(total('thru')).toHaveText('2/18');
      await card.locator('[data-strokes-minus]').click();
      await card.locator('[data-strokes-minus]').click();
      await expect(dial).toHaveAttribute('aria-valuenow', '2');
      await expect(card.locator('[data-dial-name]')).toHaveText('Birdie');
      // Dragging: straight up is par, the right side is past it, in whole strokes.
      const box = (await dial.boundingBox())!;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const r = box.width * 0.41;
      await page.mouse.move(cx, cy - r);
      await page.mouse.down();
      await expect(dial).toHaveAttribute('aria-valuenow', '3');
      await page.mouse.move(cx + r, cy, { steps: 8 });
      // 90° on a par 3: 3 + 6 × (90 / 270) = 5.
      await expect(dial).toHaveAttribute('aria-valuenow', '5');
      await expect(card.locator('[data-dial-name]')).toHaveText('Double');
      await page.mouse.move(cx + r * 0.7, cy + r * 0.7, { steps: 6 });
      await page.mouse.up();
      // The end of the sweep is double par.
      await expect(dial).toHaveAttribute('aria-valuenow', '6');
      await expect(card.locator('[data-dial-name]')).toHaveText('Triple');
      // Above double par the number keeps counting on the plus key.
      await card.locator('[data-strokes-plus]').click();
      await expect(dial).toHaveAttribute('aria-valuenow', '7');
      await expect(card.locator('[data-dial-name]')).toHaveText('+4');
      // Putts never exceed strokes: a hole in one takes them down with it.
      await typeStrokes(page, '1');
      await expect(card.locator('[data-putts-number]')).toHaveText('1');
      await expect(card.locator('[data-putts-plus]')).toBeDisabled();
      await typeStrokes(page, '3');
      await card.locator('[data-putts-plus]').click();
      await card.locator('[data-putts-plus]').click();
      await expect(card.locator('[data-putts-number]')).toHaveText('3');
      // X6: the lamps toggle.
      await lamp('gir').click();
      await expect(lamp('gir')).toHaveAttribute('aria-pressed', 'true');

      // ── A6 / A7 / X3: penalties ───────────────────────────────────────────
      await expect(badge).toHaveText('0');
      const actionsAt = (await card.locator('[data-scorer-actions]').boundingBox())!;
      await card.locator('[data-scorer-action="penalty"]').click();
      const entry = card.locator('[data-penalty-entry]');
      await expect(entry).toBeVisible();
      await expect(card.locator('[data-scorer-actions]')).toHaveCount(0);
      // In place: same spot, same height.
      const entryAt = (await entry.boundingBox())!;
      expect(Math.round(entryAt.y)).toBe(Math.round(actionsAt.y));
      expect(Math.round(entryAt.height)).toBe(Math.round(actionsAt.height));
      // The app's own list of types.
      await expect(entry.locator('[data-penalty-type] option')).toHaveText(['Penalty type', 'Out of bounds', 'Water', 'Drop', 'Lost ball', 'Unplayable', 'Re-tee']);
      await expect(entry.locator('[data-penalty-add]')).toBeDisabled();
      await expect(entry.locator('[data-penalty-strokes]')).toHaveValue('1');
      await entry.locator('[data-penalty-type]').selectOption('out_of_bounds');
      await entry.locator('[data-penalty-add]').click();
      await expect(entry).toHaveCount(0);
      const rows = card.locator('[data-penalty-row]');
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText('Out of bounds');
      await expect(rows.first().locator('[data-penalty-row-strokes]')).toHaveText('+1');
      await expect(badge).toHaveText('1');
      await card.locator('[data-scorer-action="penalty"]').click();
      await entry.locator('[data-penalty-type]').selectOption('lost_ball');
      await entry.locator('[data-penalty-strokes]').fill('2');
      await entry.locator('[data-penalty-add]').click();
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(1)).toContainText('Lost ball');
      await expect(rows.nth(1).locator('[data-penalty-row-strokes]')).toHaveText('+2');
      await expect(badge).toHaveText('3');
      // Cancel leaves everything as it was.
      await card.locator('[data-scorer-action="penalty"]').click();
      await entry.locator('[data-penalty-cancel]').click();
      await expect(rows).toHaveCount(2);
      // Penalty strokes are NOT added to the score: the dial still says 3.
      await expect(dial).toHaveAttribute('aria-valuenow', '3');

      await nextHole(page).click();
      await expectScorerOnHole(page, 3);
      await expect.poll(async () => (await saved(me.id, 2))?.penalties, { timeout: 15_000 }).toEqual(['out_of_bounds', 'lost_ball']);
      const hole2 = (await saved(me.id, 2))!;
      expect(hole2.penalty_strokes).toEqual([1, 2]);
      expect(hole2.strokes).toBe(3);
      expect(hole2.putts).toBe(3);
      expect(hole2.green_in_regulation).toBe(true);
      // A new hole: no penalties, lamps off again, its own par on the dial.
      await expect(rows).toHaveCount(0);
      await expect(badge).toHaveText('0');
      await expect(lamp('gir')).toHaveAttribute('aria-pressed', 'false');
      await expect(dial).toHaveAttribute('aria-valuenow', '5');
      await expect(dial).toHaveAttribute('aria-valuemax', '10');

      // Back on the played hole: its penalties are there again.
      await previousHole(page).click();
      await expectScorerOnHole(page, 2);
      await expect(rows).toHaveCount(2);
      await expect(badge).toHaveText('3');
      await expect(lamp('gir')).toHaveAttribute('aria-pressed', 'true');

      // ── X2: the whole card follows the selected player ────────────────────
      const tabA = card.locator(`[data-scorer-player="${rowA}"]`);
      const tabB = card.locator(`[data-scorer-player="${rowB}"]`);
      await expect(card.getByRole('tablist')).toBeVisible();
      await expect(tabA).toHaveAttribute('aria-selected', 'true');
      await tabB.click();
      await expect(tabB).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
      await expectScorerOnHole(page, 2);
      await expect(rows).toHaveCount(0);
      await expect(badge).toHaveText('0');
      await expect(total('thru')).toHaveText('0/18');
      await expect(lamp('gir')).toHaveAttribute('aria-pressed', 'false');
      await expect(key(1)).not.toHaveAttribute('data-recorded', '');
      await expect(tabB.locator('[data-scorer-player-to-par]')).toHaveText('0');
      // Looking at B's card recorded nothing for B.
      await tabA.click();
      await expect(tabA).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
      expect(await saved(bravo.id, 2)).toBeNull();
      await expectScorerOnHole(page, 2);
      await expect(rows).toHaveCount(2);

      // Removing a row lowers the badge; removing them all clears the server
      // (it used to leave the old penalties stored).
      await rows.nth(1).locator('[data-penalty-remove]').click();
      await expect(rows).toHaveCount(1);
      await expect(badge).toHaveText('1');
      await rows.first().locator('[data-penalty-remove]').click();
      await expect(rows).toHaveCount(0);
      await expect(badge).toHaveText('0');
      await key(3).click();
      await expectScorerOnHole(page, 3);
      await expect.poll(async () => (await saved(me.id, 2))?.penalties ?? [], { timeout: 15_000 }).toEqual([]);
      expect((await saved(me.id, 2))?.penalty_strokes ?? null).toBeNull();

      // A tap on the number confirms what is shown (hole 3 opens on its par, 5).
      await expect(key(3)).not.toHaveAttribute('data-recorded', '');
      await card.locator('[data-dial-confirm]').click();
      await expect(key(3)).toHaveAttribute('data-recorded', '');

      // ── A9: the map preview opens the map; "Score hole N" comes back ──────
      const preview = mapPreview(page);
      await expect(preview).toHaveAttribute('aria-label', 'Open the map on hole 3');
      await expect(preview.locator('.leaflet-container')).toBeVisible({ timeout: 20_000 });
      await preview.click();
      await expectScorerClosed(page);
      await page.locator('[aria-label="Previous hole"]').waitFor({ timeout: 30_000 });
      // The hole left by the preview was saved on the way out.
      await expect.poll(async () => (await saved(me.id, 3))?.strokes, { timeout: 15_000 }).toBe(5);
      await page.getByRole('button', { name: 'Score hole 3' }).click();
      await expectScorerOnHole(page, 3, 20_000);

      // ── A10: the last hole reads "Finish round", and saves and closes ─────
      await key(18).click();
      await expectScorerOnHole(page, 18);
      await expect(nextHole(page)).toHaveText(/Finish round/);
      await nextHole(page).click();
      await expectScorerClosed(page);
      await expect.poll(async () => (await saved(me.id, 18))?.strokes, { timeout: 15_000 }).toBe(parOf(18));
      // The round is not ended by it: cards are not full.
      expect((await readCard()).group_post.status).not.toBe('completed');
    } finally {
      await cleanup('live-score-card', [
        () => roundId && admin.from('group_posts').delete().eq('id', roundId),
        () => courseId && admin.from('golf_courses').delete().eq('id', courseId),
        () => api.dispose(),
      ]);
    }
  });
}

// The card on every screen: nothing off the screen at a small phone.
test('the scoring card fits a 320 px phone @mobile', async ({ page }) => {
  const admin = adminClient();
  const api = await apiAs('state.json');
  const stamp = Date.now();
  let roundId = '';
  try {
    const made = await api.post('/api/group-posts', {
      data: { type: 'golf_round', title: `QA Card Small ${stamp}`, date: new Date().toISOString().split('T')[0], participant_ids: [], golf_data: { course_name: `QA Card Small Course ${stamp}`, round_type: 'outdoor', holes_played: 18 } },
    });
    expect(made.ok(), await readErrorBody(made)).toBe(true);
    roundId = (await made.json()).group_post.id as string;
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(`/live/${roundId}`);
    await expectScorerOnHole(page, 1, 30_000);
    const fits = async (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(await fits(page)).toBe(true);
    for (const sel of ['[data-strokes-dial]', '[data-putts-capsule]', '[data-stat-lamp="fir"]', '[data-scorer-next]', '[data-hole-key="9"]', '[data-hole-key="18"]']) {
      const box = (await scoreCard(page).locator(sel).boundingBox())!;
      expect(box.x, sel).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, sel).toBeLessThanOrEqual(320.5);
    }
    // No map on a typed course: no preview to tap.
    await expect(mapPreview(page)).toHaveCount(0);
    // One player: no tab row.
    await expect(scoreCard(page).getByRole('tablist')).toHaveCount(0);
  } finally {
    await cleanup('live-score-card-small', [
      () => roundId && admin.from('group_posts').delete().eq('id', roundId),
      () => api.dispose(),
    ]);
  }
});
