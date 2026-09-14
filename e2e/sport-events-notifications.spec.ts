import { test, expect } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

/**
 * Events program — the bells with an action row. B accepts A's invitation
 * from the notifications page and lands as Playing; A accepts B's request
 * to join a request-mode event from the same row; a decided bell reads
 * what you did and its row is gone. Tagged @mobile: the row's buttons are
 * 44px targets at 390px on Chromium and WebKit.
 */
test('notifications: accept an invitation and a join request from the action row @mobile', async ({ page, browser }) => {

  const userB = loadQaUser('user-b.json');
  const stamp = Date.now();
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  const ids: string[] = [];
  try {
    // An invitation to B.
    const created = await apiA.post('/api/sport-events', { data: { name: `QA Bell Invite ${stamp}`, visibility: 'private', publish: true, round: { scheduled_on: '2030-06-01', course_name: 'QA Bell Links', holes: 18 } } });
    expect(created.status(), await readErrorBody(created)).toBe(201);
    const inviteEvent = ((await created.json()) as { event: { id: string } }).event.id;
    ids.push(inviteEvent);
    expect((await apiA.post(`/api/sport-events/${inviteEvent}/participants`, { data: { profile_ids: [userB.id] } })).ok()).toBe(true);

    const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const pageB = await ctxB.newPage();
      await pageB.goto('/app/notifications');
      // Scope to THIS event's card: the QA users are shared across specs and
      // other specs leave their own pending invitations behind.
      const card = pageB.locator('[data-notification-card][data-notification-type="sport_event_invite"]').filter({ hasText: `QA Bell Invite ${stamp}` }).first();
      await expect(card).toBeVisible({ timeout: 20_000 });
      await expect(card.getByText(`Edge Alpha invited you to QA Bell Invite ${stamp}`)).toBeVisible();
      await card.locator('[data-notification-accept]').click();
      await expect(card.getByText(`You accepted the invitation to QA Bell Invite ${stamp}`)).toBeVisible({ timeout: 15_000 });
      await expect(card.locator('[data-notification-action-row]')).toHaveCount(0);
    } finally {
      await ctxB.close();
    }
    const view = (await (await apiA.get(`/api/sport-events/${inviteEvent}`)).json()) as { participants: Array<{ profile_id: string; status: string }> };
    expect(view.participants.find(p => p.profile_id === userB.id)?.status).toBe('accepted');

    // A request-mode event: B asks, A accepts from the bell.
    const open = await apiA.post('/api/sport-events', { data: { name: `QA Bell Request ${stamp}`, visibility: 'public', join_mode: 'request', publish: true, round: { scheduled_on: '2030-06-02', course_name: 'QA Bell Links', holes: 18 } } });
    expect(open.status(), await readErrorBody(open)).toBe(201);
    const requestEvent = ((await open.json()) as { event: { id: string } }).event.id;
    ids.push(requestEvent);
    const asked = await apiB.post(`/api/sport-events/${requestEvent}/participants/request`);
    expect(asked.ok(), await readErrorBody(asked)).toBe(true);

    await page.goto('/app/notifications');
    const reqCard = page.locator('[data-notification-card][data-notification-type="sport_event_request"]').filter({ hasText: `QA Bell Request ${stamp}` }).first();
    await expect(reqCard).toBeVisible({ timeout: 20_000 });
    await reqCard.locator('[data-notification-accept]').click();
    await expect(reqCard.getByText(`You accepted Edge Bravo's request to join QA Bell Request ${stamp}`)).toBeVisible({ timeout: 15_000 });
    await expect(reqCard.locator('[data-notification-action-row]')).toHaveCount(0);
    const view2 = (await (await apiA.get(`/api/sport-events/${requestEvent}`)).json()) as { participants: Array<{ profile_id: string; status: string }> };
    expect(view2.participants.find(p => p.profile_id === userB.id)?.status).toBe('accepted');
  } finally {
    for (const id of ids) {
      await apiA.post(`/api/sport-events/${id}/transition`, { data: { to: 'cancelled' } }).catch(() => null);
      await apiA.delete(`/api/sport-events/${id}`).catch(() => null);
    }
    await apiA.dispose();
    await apiB.dispose();
  }
});
