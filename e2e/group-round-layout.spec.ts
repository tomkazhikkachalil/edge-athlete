import { readFileSync } from 'fs';
import path from 'path';
import { test, expect, type Page } from './helpers/test';
import { cleanup } from './helpers/cleanup';
import { expectScorerOnHole, strokesDial, typeStrokes } from './helpers/score-card';
import { fitsViewportWidth } from './helpers/layout';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';
import { cardRowFor, cleanupEvent, completeRound, createEvent, inviteAndAccept, openEventSession, readScorecard, scoreHoles, startRound } from './helpers/sport-events';

// Nov 20 2026: the Nov 19 group-round fixes that were pinned at source level
// only (src/lib/__tests__/round-layout-nov19.test.ts), now in a browser:
//   • a long name on an event's leaderboards is cut, and the scores stay on screen;
//   • a posted round's hole media sits in one strip BELOW the scorecard;
//   • the scorer fits a 375 px phone, with a long name among the players.

const LONG_FIRST = 'Maximilianalexanderchristopherbartholomew'; // 41 letters, no break point
const today = () => new Date().toISOString().split('T')[0];
const nineOf = (strokes: number) => Array.from({ length: 9 }, (_, i) => ({ hole_number: i + 1, strokes }));

/** Give a QA user a very long first name; returns the undo. */
async function withLongName(profileId: string): Promise<() => Promise<void>> {
  const admin = adminClient();
  const { data: prior, error } = await admin.from('profiles').select('first_name, full_name, display_name').eq('id', profileId).single();
  if (error || !prior) throw new Error(`could not read the profile to rename: ${error?.message}`);
  const full = `${LONG_FIRST} ${String(prior.full_name ?? '').split(' ').slice(1).join(' ')}`.trim();
  const set = await admin.from('profiles').update({ first_name: LONG_FIRST, full_name: full, display_name: full }).eq('id', profileId);
  if (set.error) throw new Error(`could not set the long name: ${set.error.message}`);
  return async () => {
    await admin.from('profiles').update({ first_name: prior.first_name, full_name: prior.full_name, display_name: prior.display_name }).eq('id', profileId);
  };
}

/** The element is wholly inside the screen's width. */
async function insideScreen(page: Page, selector: string, what: string) {
  const box = await page.locator(selector).first().boundingBox();
  expect(box, `${what} is on the page`).not.toBeNull();
  const width = page.viewportSize()!.width;
  expect(box!.x, `${what} starts inside the screen`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${what} ends inside the screen`).toBeLessThanOrEqual(width + 0.5);
}

async function leaderboardsCutALongName(page: Page) {
  test.setTimeout(180_000);
  const s = await openEventSession();
  let eventId: string | null = null;
  let undo: (() => Promise<void>) | null = null;
  try {
    undo = await withLongName(s.userB.id);
    let view = await createEvent(s.apiA, {
      name: `QA Long Names ${s.stamp}`,
      publish: true,
      rounds: [
        { scheduled_on: '2030-06-01', course_name: 'QA Links', holes: 9, starting_hole: 1 },
        { scheduled_on: '2030-06-02', course_name: 'QA Links', holes: 9, starting_hole: 1 },
      ],
    });
    eventId = view.event.id;
    const [r1] = view.rounds.map(r => r.id);
    await inviteAndAccept(s, eventId);
    view = await startRound(s.apiA, eventId, r1, '2030-06-01');
    const card = await readScorecard(s.apiA, view.rounds[0].group_post_id!);
    await scoreHoles(s.apiA, cardRowFor(card, s.userA.id), nineOf(4));
    await scoreHoles(s.apiB, cardRowFor(card, s.userB.id), nineOf(5));
    await completeRound(s.apiA, eventId, r1);

    // The round's board.
    await page.goto(`/events/${eventId}?tab=leaderboard&round=${r1}`);
    const roundRow = `[data-leaderboard-row="${s.userB.id}"]`;
    await expect(page.locator(roundRow)).toBeVisible({ timeout: 20_000 });
    const roundName = page.locator(`${roundRow} [data-board-name]`);
    await expect(roundName).toContainText(LONG_FIRST.slice(0, 6));
    // Cut, not wrapped and not pushed off: the text is wider than its box.
    expect(await roundName.evaluate(el => el.scrollWidth > el.clientWidth), 'the long name is truncated on the round board').toBe(true);
    await insideScreen(page, roundRow, 'the long-named row on the round board');
    expect(await fitsViewportWidth(page), 'no sideways scroll on the round board').toBe(true);

    // The overall board.
    await page.goto(`/events/${eventId}?tab=leaderboard&round=overall`);
    const overallRow = `[data-overall-row="${s.userB.id}"]`;
    await expect(page.locator(overallRow)).toBeVisible({ timeout: 20_000 });
    const overallName = page.locator(`${overallRow} [data-board-name]`);
    expect(await overallName.evaluate(el => el.scrollWidth > el.clientWidth), 'the long name is truncated on the overall board').toBe(true);
    // This board is a table that scrolls inside its own frame when it has many
    // columns (at 390 px with two rounds it is a few pixels wider than the
    // screen: cell padding). What must hold is that the scores can be READ
    // without scrolling: the text of the row's last two cells is on screen.
    const scoreEdges = await page.locator(`${overallRow} td`).evaluateAll(cells => cells.slice(-2).map(cell => {
      const range = document.createRange();
      range.selectNodeContents(cell);
      const rect = range.getBoundingClientRect();
      return { left: rect.left, right: rect.right, text: cell.textContent ?? '' };
    }));
    expect(scoreEdges).toHaveLength(2);
    for (const edge of scoreEdges) {
      expect(edge.text.trim().length, 'a score cell has text').toBeGreaterThan(0);
      expect(edge.left, `"${edge.text}" starts on screen`).toBeGreaterThanOrEqual(0);
      expect(edge.right, `"${edge.text}" ends on screen`).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
    expect(await fitsViewportWidth(page), 'no sideways scroll on the overall board').toBe(true);
  } finally {
    await cleanup('group-round-layout:leaderboards', [
      () => undo?.(),
      () => cleanupEvent(s.apiA, eventId),
      () => s.dispose(),
    ]);
  }
}

test('event leaderboards: a very long name is cut and the row stays on screen', async ({ page }) => leaderboardsCutALongName(page));
test('event leaderboards at phone width: a very long name is cut and the row stays on screen @mobile', async ({ page }) => leaderboardsCutALongName(page));

async function holeMediaBelowTheScorecard(page: Page) {
  test.setTimeout(150_000);
  const png = readFileSync(path.join(__dirname, 'fixtures', 'photo.png'));
  const api = await apiAs('state.json');
  const me = loadQaUser('user.json');
  let id = '';
  try {
    const created = await api.post('/api/group-posts', {
      data: { type: 'golf_round', title: `QA Hole Media ${Date.now()}`, date: today(), visibility: 'private', participant_ids: [], golf_data: { course_name: `QA Hole Media Course ${Date.now()}`, round_type: 'outdoor', holes_played: 9 } },
    });
    expect(created.ok(), await readErrorBody(created)).toBe(true);
    id = (await created.json()).group_post.id as string;
    // A photo on hole 3 and one on hole 1, attached out of order.
    for (const hole of [3, 1]) {
      const up = await api.post('/api/upload/post-media', { multipart: { file: { name: 'photo.png', mimeType: 'image/png', buffer: png } } });
      expect(up.ok(), await readErrorBody(up)).toBe(true);
      const add = await api.post(`/api/group-posts/${id}/media`, { data: { media_url: (await up.json()).url, media_type: 'image', segment_number: hole } });
      expect(add.ok(), await readErrorBody(add)).toBe(true);
    }
    const card = await (await api.get(`/api/group-posts/${id}/scorecard`)).json() as { scorecard: { participants: Array<{ participant: { id: string; profile_id: string } }> } };
    const row = card.scorecard.participants.find(p => p.participant.profile_id === me.id)!.participant.id;
    expect((await api.post(`/api/golf/scorecards/${row}/scores`, { data: { scores: nineOf(4) } })).status()).toBe(201);

    await page.goto(`/live/${id}`);
    await page.getByRole('button', { name: /View Full Scorecard/i }).first().click({ timeout: 30_000 });
    const tab = page.getByRole('tab', { name: /Full Scorecard/i });
    if (await tab.count()) await tab.first().click();
    const panel = page.locator('#round-panel-scorecard');
    await expect(panel.locator('table').first()).toBeVisible({ timeout: 15_000 });

    const strip = panel.locator('[data-round-hole-media]');
    await expect(strip).toBeVisible({ timeout: 15_000 });
    // One tile per hole that has media, in hole order.
    await expect(strip.locator('[data-round-hole-media-tile]')).toHaveCount(2);
    expect(await strip.locator('[data-round-hole-media-tile]').evaluateAll(els => els.map(el => el.getAttribute('data-round-hole-media-tile')))).toEqual(['1', '3']);
    // Never inside the scorecard's table, and below every table of the card.
    await expect(panel.locator('table [data-round-hole-media-tile]')).toHaveCount(0);
    const stripTop = (await strip.boundingBox())!.y;
    for (const table of await panel.locator('table').all()) {
      const box = (await table.boundingBox())!;
      expect(box.y + box.height, 'the media strip is below the scorecard').toBeLessThanOrEqual(stripTop + 0.5);
    }
    await insideScreen(page, '#round-panel-scorecard [data-round-hole-media]', 'the media strip');
  } finally {
    await cleanup('group-round-layout:media', [
      () => id && api.delete(`/api/group-posts/${id}`),
      () => api.dispose(),
    ]);
  }
}

test('a posted round: hole media sits in one strip below the scorecard, in hole order', async ({ page }) => holeMediaBelowTheScorecard(page));
test('a posted round at phone width: hole media sits in one strip below the scorecard @mobile', async ({ page }) => holeMediaBelowTheScorecard(page));

test('the scorer fits a 375 px phone, with a very long name among the players @mobile', async ({ page }) => {
  test.setTimeout(150_000);
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const api = await apiAs('state.json');
  let id = '';
  let undo: (() => Promise<void>) | null = null;
  try {
    undo = await withLongName(userB.id);
    const created = await api.post('/api/group-posts', {
      data: { type: 'golf_round', title: `QA Narrow Scorer ${Date.now()}`, date: today(), visibility: 'private', participant_ids: [userB.id], golf_data: { course_name: `QA Narrow Scorer Course ${Date.now()}`, round_type: 'outdoor', holes_played: 9 } },
    });
    expect(created.ok(), await readErrorBody(created)).toBe(true);
    id = (await created.json()).group_post.id as string;
    const card = await (await api.get(`/api/group-posts/${id}/scorecard`)).json() as { scorecard: { participants: Array<{ participant: { id: string; profile_id: string } }> } };
    const rowOf = (profileId: string) => card.scorecard.participants.find(p => p.participant.profile_id === profileId)!.participant.id;

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/live/${id}`);
    await expectScorerOnHole(page, 1, 30_000);
    const chipA = `[data-scorer-player="${rowOf(userA.id)}"]`;
    const chipB = `[data-scorer-player="${rowOf(userB.id)}"]`;
    await expect(page.locator(chipA)).toBeVisible();
    await expect(page.locator('[data-scorer-status="live"]')).toBeVisible();

    expect(await fitsViewportWidth(page), 'no sideways scroll with the scorer open at 375 px').toBe(true);
    await insideScreen(page, '[data-scorer-status="live"]', 'the LIVE badge');
    await insideScreen(page, '[data-scorer-to-par]', 'the to-par line');
    await insideScreen(page, chipA, "the scorer's own chip");
    // The long-named player: reachable, and inside the screen once reached.
    await page.locator(chipB).scrollIntoViewIfNeeded();
    await insideScreen(page, chipB, 'the long-named chip');
    await page.locator(chipB).click();
    await expect(page.locator(chipB)).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
    await expectScorerOnHole(page, 1);
    // The strokes control is usable: a typed digit lands, and it is on screen.
    const strokes = strokesDial(page);
    const box = (await strokes.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375.5);
    await typeStrokes(page, '5');
    expect(await fitsViewportWidth(page), 'still no sideways scroll after switching to the long-named player').toBe(true);
  } finally {
    await cleanup('group-round-layout:scorer', [
      () => undo?.(),
      () => id && api.delete(`/api/group-posts/${id}`),
      () => api.dispose(),
    ]);
  }
});
