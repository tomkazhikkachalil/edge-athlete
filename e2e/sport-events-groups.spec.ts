import { test, expect } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';
import { cardRowFor, cleanupEvent, completeRound, createEvent, inviteAndAccept, openEventSession, readScorecard, readView, scoreHoles, startRound } from './helpers/sport-events';

/**
 * Events program — the groups editor on the event page. A places B and
 * then themselves in a group, moves B down, sets a tee time and the
 * tenth hole, saves; the API shows the plan in that order; B never sees
 * the Groups tab. Tagged @mobile: the pool, the group card and the
 * reorder buttons at 390px on Chromium and WebKit.
 */
test('groups editor: add, assign, reorder, tee time, save; hidden from a player @mobile', async ({ page, browser }) => {
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const stamp = Date.now();
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  let eventId: string | null = null;
  try {
    const created = await apiA.post('/api/sport-events', { data: { name: `QA Groups ${stamp}`, visibility: 'private', publish: true, round: { scheduled_on: '2030-06-01', course_name: 'QA Groups Links', holes: 18 } } });
    expect(created.status(), await readErrorBody(created)).toBe(201);
    const view = (await created.json()) as { event: { id: string }; rounds: Array<{ id: string }> };
    eventId = view.event.id;

    expect((await apiA.post(`/api/sport-events/${eventId}/participants`, { data: { profile_ids: [userB.id] } })).ok()).toBe(true);
    const asB = (await (await apiB.get(`/api/sport-events/${eventId}`)).json()) as { viewer: { participant_id: string } };
    expect((await apiB.post(`/api/sport-events/${eventId}/participants/${asB.viewer.participant_id}`, { data: { action: 'accept' } })).ok()).toBe(true);

    await page.goto(`/events/${eventId}?tab=groups`);
    await expect(page.getByRole('tab', { name: 'Groups' })).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 });
    await expect(page.locator('[data-groups-pool]')).toHaveCount(2);
    await page.locator('[data-groups-add]').click();
    await expect(page.locator('[data-groups-group="1"]')).toBeVisible();
    // B first, then A.
    await page.getByRole('combobox', { name: 'Put Edge B. in a group' }).selectOption({ index: 1 });
    await page.getByRole('combobox', { name: 'Put Edge A. in a group' }).selectOption({ index: 1 });
    await expect(page.locator('[data-groups-pool]')).toHaveCount(0);
    // Move B down → A, B.
    await page.getByRole('button', { name: /Move Edge B. down/i }).click();
    await page.getByRole('textbox', { name: 'Group 1 name' }).fill('Early');
    await page.locator('[data-groups-tee]').fill('08:10');
    await page.getByRole('combobox', { name: 'Group 1 starting hole' }).selectOption('10');
    await page.locator('[data-groups-save]').click();
    await expect(page.locator('[data-groups-notice]')).toHaveText('Groups saved.', { timeout: 15_000 });
    await expect(page.locator('[data-groups-save]')).toHaveText('Saved');

    const after = (await (await apiA.get(`/api/sport-events/${eventId}`)).json()) as { participants: Array<{ id: string; profile_id: string }>; groups: Array<{ name: string | null; starting_hole: number; tee_time: string | null; members: Array<{ participant_id: string; position: number }> }> };
    const idOf = (profile: string) => after.participants.find(p => p.profile_id === profile)!.id;
    expect(after.groups).toHaveLength(1);
    expect(after.groups[0]).toMatchObject({ name: 'Early', starting_hole: 10 });
    expect(after.groups[0].tee_time).toBeTruthy();
    expect(after.groups[0].members.map(m => m.participant_id)).toEqual([idOf(userA.id), idOf(userB.id)]);

    // B (a player) has no Groups tab; the deep link lands on the overview.
    const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const pageB = await ctxB.newPage();
      await pageB.goto(`/events/${eventId}?tab=groups`);
      await expect(pageB.getByRole('heading', { name: `QA Groups ${stamp}` })).toBeVisible({ timeout: 20_000 });
      await expect(pageB.getByRole('tab', { name: 'Groups' })).toHaveCount(0);
      await expect(pageB.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    } finally {
      await ctxB.close();
    }
  } finally {
    if (eventId) {
      await apiA.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'cancelled' } }).catch(() => null);
      await apiA.delete(`/api/sport-events/${eventId}`).catch(() => null);
    }
    await apiA.dispose();
    await apiB.dispose();
  }
});

/**
 * Phase 2, PR 10 — regroup by standing: after round 1 (A 36, B 45) the
 * organizer lays round 2's groups from the overall board, leaders last:
 * B tees off before A in one group; Save; the round 2 mint honours it.
 */
test('groups editor: group round 2 by standing, leaders last; the mint honours it @mobile', async ({ page }) => {
  const s = await openEventSession();
  let eventId: string | null = null;
  try {
    let view = await createEvent(s.apiA, {
      name: `QA Standing ${s.stamp}`,
      publish: true,
      rounds: [
        { scheduled_on: '2030-06-01', course_name: 'QA Links', holes: 9, starting_hole: 1 },
        { scheduled_on: '2030-06-02', course_name: 'QA Links', holes: 9, starting_hole: 1 },
      ],
    });
    eventId = view.event.id;
    const [r1, r2] = view.rounds.map(r => r.id);
    await inviteAndAccept(s, eventId);
    view = await startRound(s.apiA, eventId, r1, '2030-06-01');
    const card1 = await readScorecard(s.apiA, view.rounds[0].group_post_id!);
    const nine = (strokes: number) => Array.from({ length: 9 }, (_, i) => ({ hole_number: i + 1, strokes }));
    await scoreHoles(s.apiA, cardRowFor(card1, s.userA.id), nine(4));
    await scoreHoles(s.apiB, cardRowFor(card1, s.userB.id), nine(5));
    await completeRound(s.apiA, eventId, r1);

    await page.goto(`/events/${eventId}?tab=groups&round=${r2}`);
    await expect(page.locator(`[data-event-groups-editor="${r2}"]`)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-groups-standing]')).toBeVisible();
    await page.locator('[data-standing-size]').selectOption('4');
    await page.locator('[data-standing-order]').selectOption('leaders_last');
    await page.locator('[data-groups-by-standing]').click();
    await expect(page.locator('[data-groups-notice]')).toContainText('from the standing');
    await expect(page.locator('[data-groups-group="1"]')).toBeVisible();
    await expect(page.locator('[data-groups-group="1"] ol, [data-groups-group="1"] [data-reorder-list]').first()).toContainText(/Edge B\.[\s\S]*Edge A\./);
    await page.locator('[data-groups-save]').click();
    await expect(page.locator('[data-groups-notice]')).toHaveText('Groups saved.', { timeout: 15_000 });

    const after = await readView(s.apiA, eventId);
    const idOf = (profile: string) => after.participants.find(p => p.profile_id === profile)!.id;
    const g2 = after.groups.filter(g => g.sport_event_round_id === r2);
    expect(g2).toHaveLength(1);
    expect(g2[0].members.map(m => m.participant_id)).toEqual([idOf(s.userB.id), idOf(s.userA.id)]);

    // The round 2 mint honours the plan.
    view = await startRound(s.apiA, eventId, r2, '2030-06-02');
    const card2 = await readScorecard(s.apiA, view.rounds[1].group_post_id!);
    expect(card2.sport_event!.group!.members.map(m => m.profile_id)).toEqual([s.userB.id, s.userA.id]);
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await s.dispose();
  }
});
