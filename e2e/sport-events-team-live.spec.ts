import { test, expect } from '@playwright/test';
import { adminClient, readErrorBody } from './helpers/qa-user';
import { cleanupEvent, createEvent, goLive, openEventSession, readView, setGroups } from './helpers/sport-events';

type StatsPayload = { round: { score: { side1_score: number | null; side2_score: number | null; version: number } }; lines: Array<{ id: string; profile_id: string; stats: Record<string, number>; version: number }> };

/**
 * Events program, phase 4, PR 9 — the live stat screen at phone width on
 * Chromium and WebKit. NEEDS MIGRATION 215 ON THE TARGET (self-skips
 * before) and the four QA users. A public hockey game: B (self entry)
 * opens /events/[id]/live, taps their own line, +1 goal and +1 assist
 * land through the outbox (the line reads saved, the API carries them);
 * C's line is not enterable for B; A (the organizer) keeps the score with
 * the chips — the label and the API follow; a stranger watches the same
 * screen signed out with no strip; the Stats tab's door opens the screen.
 */
test('the live stat screen: a player\'s own line, the outbox, the organizer\'s score, the stranger\'s watch @mobile', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const s = await openEventSession();
  const admin = adminClient();
  const probe = await admin.from('sport_events').select('shape').limit(1);
  test.skip(!!probe.error, 'sport_events.shape missing — run migration 215');
  test.skip(!s.apiC || !s.userC, 'the four QA users are not minted — an older global setup');
  const apiC = s.apiC!;
  const userC = s.userC!;
  let eventId: string | null = null;
  try {
    const view = await createEvent(s.apiA, { name: `QA Live Stats ${s.stamp}`, sport_key: 'ice_hockey', shape: 'game', visibility: 'public', join_mode: 'open', publish: true, host_plays: false, format_config: { game: { side_names: ['Reds', 'Blues'] } }, round: { scheduled_on: '2030-06-01', course_name: 'QA Rink' } });
    eventId = view.event.id;
    const roundId = view.rounds[0].id;
    for (const api of [s.apiB, apiC]) {
      const joined = await api.post(`/api/sport-events/${eventId}/participants/join`, { data: {} });
      expect(joined.ok(), await readErrorBody(joined)).toBe(true);
    }
    const v = await readView(s.apiA, eventId);
    const bId = v.participants.find(p => p.profile_id === s.userB.id)!.id;
    const cId = v.participants.find(p => p.profile_id === userC.id)!.id;
    await setGroups(s.apiA, eventId, roundId, [{ name: 'The game', members: [{ participant_id: bId, side: 1 }, { participant_id: cId, side: 2 }] }]);
    await goLive(s.apiA, eventId, '2030-06-01');
    const statsUrl = `/api/sport-events/${eventId}/rounds/${roundId}/stats`;
    const liveUrl = `/events/${eventId}/live?round=${roundId}`;

    // B: own line enterable, C's not; +1 G, +1 A through the strip; the line reads saved and the API carries it.
    const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const pageB = await ctxB.newPage();
      await pageB.goto(liveUrl);
      await expect(pageB.locator('[data-live-stats]')).toBeVisible({ timeout: 20_000 });
      const mine = pageB.locator(`[data-live-line="${s.userB.id}"]`);
      await expect(mine).toHaveAttribute('data-live-line-enterable', '1', { timeout: 20_000 });
      await expect(pageB.locator(`[data-live-line="${userC.id}"]`)).toHaveAttribute('data-live-line-enterable', '0');
      await mine.click();
      await expect(pageB.locator('[data-stat-strip]')).toBeVisible();
      await pageB.locator('[data-stat-plus="goals"]').click();
      await pageB.locator('[data-stat-plus="assists"]').click();
      await expect(pageB.locator('[data-stat-value="goals"]')).toHaveText('1');
      await expect(pageB.locator('[data-stat-value="assists"]')).toHaveText('1');
      await expect(pageB.locator('[data-stat-strip-state]')).toHaveAttribute('data-stat-strip-state', 'saved', { timeout: 30_000 });
      await expect(mine).toHaveAttribute('data-line-state', 'saved');
      await expect(pageB.locator(`[data-live-cell="${s.userB.id}:goals"]`)).toHaveText(/1/);
      // The minus chip refuses below zero (disabled), never clamps.
      await pageB.locator('[data-stat-minus="goals"]').click();
      await expect(pageB.locator('[data-stat-value="goals"]')).toHaveText('0');
      await expect(pageB.locator('[data-stat-minus="goals"]')).toBeDisabled();
      await expect(pageB.locator('[data-stat-strip-state]')).toHaveAttribute('data-stat-strip-state', 'saved', { timeout: 30_000 });
    } finally {
      await ctxB.close();
    }
    const afterB = (await (await s.apiA.get(statsUrl)).json()) as StatsPayload;
    // Three taps, each flushed as it lands when online (the outbox coalesces only while a flush is pending): the stats are the fact, the version is at least the two the taps must have produced.
    const bAfter = afterB.lines.find(l => l.profile_id === s.userB.id);
    expect(bAfter).toMatchObject({ stats: { goals: 0, assists: 1 } });
    expect(bAfter!.version).toBeGreaterThanOrEqual(2);

    // A (the organizer, on the test's own page at 390): the score chips; every line enterable; the Stats tab's door.
    await page.goto(`/events/${eventId}?tab=stats`);
    await expect(page.locator('[data-event-stats-board]')).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-event-live-open]').click();
    await expect(page).toHaveURL(new RegExp(`/events/${eventId}/live`), { timeout: 20_000 });
    await expect(page.locator('[data-score-control]')).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-score-plus="1"]').click();
    await expect(page.locator('[data-event-score-line]')).toHaveText(/Reds 1 – 0 Blues/, { timeout: 20_000 });
    await page.locator('[data-score-plus="2"]').click();
    await expect(page.locator('[data-event-score-line]')).toHaveText(/Reds 1 – 1 Blues/, { timeout: 20_000 });
    await expect(page.locator(`[data-live-line="${userC.id}"]`)).toHaveAttribute('data-live-line-enterable', '1');
    await expect.poll(async () => ((await (await s.apiA.get(statsUrl)).json()) as StatsPayload).round.score, { timeout: 20_000 }).toMatchObject({ side1_score: 1, side2_score: 1, version: 2 });

    // A stranger watches: the board, no strip, no score chips.
    const ctxAnon = await browser.newContext({ storageState: 'e2e/.auth/anon.json' });
    try {
      const anon = await ctxAnon.newPage();
      await anon.goto(liveUrl);
      await expect(anon.locator('[data-live-stats]')).toBeVisible({ timeout: 20_000 });
      await expect(anon.locator('[data-event-score-line]')).toHaveText(/Reds 1 – 1 Blues/, { timeout: 20_000 });
      await expect(anon.locator(`[data-live-line="${s.userB.id}"]`)).toHaveAttribute('data-live-line-enterable', '0');
      await expect(anon.locator('[data-score-control]')).toHaveCount(0);
      await expect(anon.locator('[data-stat-strip]')).toHaveCount(0);
    } finally {
      await ctxAnon.close();
    }
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await s.dispose();
  }
});
