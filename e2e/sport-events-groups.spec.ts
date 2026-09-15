import { test, expect } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

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
