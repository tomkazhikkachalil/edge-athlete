import { test, expect } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

/**
 * Events program — the group card on the live page. A and B share a
 * group on a live nine; B opens the round: two columns, the event back
 * link. B scores hole 1 (saved dot), goes OFFLINE, scores hole 2 (waiting
 * dot), comes back online (saved) — the API has both holes. B then scores
 * A's hole 1 as a group-mate after the confirm. Tagged @mobile on Chromium
 * and WebKit at 390 × 844.
 */
test('group card: two columns, score, offline queue, reconnect, a partner\'s hole @mobile', async ({ browser }) => {
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const stamp = Date.now();
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  let eventId: string | null = null;
  try {
    const created = await apiA.post('/api/sport-events', { data: { name: `QA Group Card ${stamp}`, visibility: 'private', publish: true, round: { scheduled_on: '2030-06-01', course_name: 'QA Card Links', holes: 9 } } });
    expect(created.status(), await readErrorBody(created)).toBe(201);
    const view = (await created.json()) as { event: { id: string }; rounds: Array<{ id: string }> };
    eventId = view.event.id;
    const roundId = view.rounds[0].id;
    expect((await apiA.post(`/api/sport-events/${eventId}/participants`, { data: { profile_ids: [userB.id] } })).ok()).toBe(true);
    const asB = (await (await apiB.get(`/api/sport-events/${eventId}`)).json()) as { viewer: { participant_id: string }; participants: Array<{ id: string; role: string }> };
    expect((await apiB.post(`/api/sport-events/${eventId}/participants/${asB.viewer.participant_id}`, { data: { action: 'accept' } })).ok()).toBe(true);
    const host = asB.participants.find(p => p.role === 'organizer')!;
    expect((await apiA.put(`/api/sport-events/${eventId}/rounds/${roundId}/groups`, { data: { groups: [{ members: [host.id, asB.viewer.participant_id] }] } })).ok()).toBe(true);
    const live = await apiA.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'live', today: '2030-06-01' } });
    expect(live.ok(), await readErrorBody(live)).toBe(true);
    const gp = ((await live.json()) as { rounds: Array<{ group_post_id: string }> }).rounds[0].group_post_id;

    const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ctxB.newPage();
      await page.goto(`/live/${gp}`);
      await expect(page.locator('[data-group-score-card]')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-gsc-col]')).toHaveCount(2);
      await expect(page.locator('[data-live-back]')).toHaveAttribute('href', `/events/${eventId}?tab=leaderboard`);

      // Hole 1, my column: the wheel rests on par; Save 4 & next.
      await page.locator(`[data-gsc-cell="${userB.id}:1"]`).click();
      await expect(page.locator(`[data-gsc-editor="${userB.id}:1"]`)).toBeVisible();
      await page.locator('[data-gsc-save]').click();
      await expect(page.locator(`[data-gsc-cell="${userB.id}:1"]`)).toHaveAttribute('data-gsc-state', 'saved', { timeout: 15_000 });
      await expect(page.locator(`[data-gsc-cell="${userB.id}:1"]`)).toHaveText(/4/);
      // The editor advanced to hole 2.
      await expect(page.locator(`[data-gsc-editor="${userB.id}:2"]`)).toBeVisible();

      // Offline: hole 2 queues (waiting), then lands after reconnect.
      await ctxB.setOffline(true);
      await page.locator('[data-gsc-save]').click();
      await expect(page.locator(`[data-gsc-cell="${userB.id}:2"]`)).toHaveAttribute('data-gsc-state', 'pending');
      await ctxB.setOffline(false);
      await expect(page.locator(`[data-gsc-cell="${userB.id}:2"]`)).toHaveAttribute('data-gsc-state', 'saved', { timeout: 30_000 });

      // A partner's hole: the confirm, then the entry lands (the group-mate right).
      await page.locator('[data-gsc-editor]').getByRole('button', { name: 'Close the editor' }).click();
      await page.locator(`[data-gsc-cell="${userA.id}:1"]`).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Enter scores' }).click();
      await expect(page.locator(`[data-gsc-editor="${userA.id}:1"]`)).toBeVisible();
      await page.locator('[data-gsc-save]').click();
      await expect(page.locator(`[data-gsc-cell="${userA.id}:1"]`)).toHaveAttribute('data-gsc-state', 'saved', { timeout: 15_000 });
    } finally {
      await ctxB.close();
    }

    const card = (await (await apiA.get(`/api/group-posts/${gp}/scorecard`)).json()) as { scorecard: { participants: Array<{ participant: { profile_id: string }; scores: { hole_scores: Array<{ hole_number: number; strokes: number }> } }> } };
    const holesOf = (profile: string) => card.scorecard.participants.find(p => p.participant.profile_id === profile)!.scores.hole_scores.map(h => [h.hole_number, h.strokes]).sort((a, b) => a[0] - b[0]);
    expect(holesOf(userB.id)).toEqual([[1, 4], [2, 4]]);
    expect(holesOf(userA.id)).toEqual([[1, 4]]);
  } finally {
    if (eventId) {
      await apiA.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'completed', override: true } }).catch(() => null);
      await apiA.delete(`/api/sport-events/${eventId}`).catch(() => null);
    }
    await apiA.dispose();
    await apiB.dispose();
  }
});
