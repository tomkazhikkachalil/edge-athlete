import { test, expect } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

/**
 * Events program — the Scorecard tab. Live round, B scores a hole, B
 * submits their card from the tab; A sees it Submitted, marks it final,
 * reopens it, marks it final again; the Complete confirm names A's own
 * card as not final; completing flips the header to Final. Names are
 * masked ("Edge A.", "Edge B."). Tagged @mobile on Chromium and WebKit.
 */
test('scorecard tab: submit, mark final, reopen, complete with the not-final list @mobile', async ({ page, browser }) => {

  const userB = loadQaUser('user-b.json');
  const stamp = Date.now();
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  let eventId: string | null = null;
  try {
    const created = await apiA.post('/api/sport-events', { data: { name: `QA Cards ${stamp}`, visibility: 'private', publish: true, round: { scheduled_on: '2030-06-01', course_name: 'QA Cards Links', holes: 9 } } });
    expect(created.status(), await readErrorBody(created)).toBe(201);
    eventId = ((await created.json()) as { event: { id: string } }).event.id;
    expect((await apiA.post(`/api/sport-events/${eventId}/participants`, { data: { profile_ids: [userB.id] } })).ok()).toBe(true);
    const asB = (await (await apiB.get(`/api/sport-events/${eventId}`)).json()) as { viewer: { participant_id: string } };
    expect((await apiB.post(`/api/sport-events/${eventId}/participants/${asB.viewer.participant_id}`, { data: { action: 'accept' } })).ok()).toBe(true);
    const live = await apiA.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'live', today: '2030-06-01' } });
    expect(live.ok(), await readErrorBody(live)).toBe(true);
    const gp = ((await live.json()) as { rounds: Array<{ group_post_id: string }> }).rounds[0].group_post_id;
    const card = (await (await apiB.get(`/api/group-posts/${gp}/scorecard`)).json()) as { scorecard: { participants: Array<{ participant: { id: string; profile_id: string } }> } };
    const rowB = card.scorecard.participants.find(p => p.participant.profile_id === userB.id)!.participant.id;
    expect((await apiB.post(`/api/golf/scorecards/${rowB}/scores`, { data: { scores: [{ hole_number: 1, strokes: 5 }] } })).status()).toBe(201);

    // B: my card, in progress → Submit my card → Submitted.
    const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const pageB = await ctxB.newPage();
      await pageB.goto(`/events/${eventId}?tab=scorecard`);
      await expect(pageB.getByRole('tab', { name: 'Scorecard' })).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 });
      await expect(pageB.locator('[data-my-card="in_progress"]')).toBeVisible({ timeout: 15_000 });
      await expect(pageB.locator('[data-open-my-scorecard]')).toHaveAttribute('href', `/live/${gp}`);
      await pageB.locator('[data-submit-my-card]').click();
      await expect(pageB.locator('[data-my-card="submitted"]')).toBeVisible({ timeout: 15_000 });
      await expect(pageB.locator('[data-mark-final]')).toHaveCount(0); // a player marks nothing final
    } finally {
      await ctxB.close();
    }

    // A: B is Submitted → Mark final → Final → Reopen → In progress → Mark final.
    await page.goto(`/events/${eventId}?tab=scorecard`);
    const rowBCard = page.locator(`[data-card-row="${userB.id}"]`);
    await expect(rowBCard.locator('[data-card-status="submitted"]')).toBeVisible({ timeout: 20_000 });
    await rowBCard.locator('[data-mark-final]').click();
    await expect(rowBCard.locator('[data-card-status="final"]')).toBeVisible({ timeout: 15_000 });
    await rowBCard.locator('[data-reopen]').click();
    await expect(rowBCard.locator('[data-card-status="in_progress"]')).toBeVisible({ timeout: 15_000 });
    await rowBCard.locator('[data-mark-final]').click();
    await expect(rowBCard.locator('[data-card-status="final"]')).toBeVisible({ timeout: 15_000 });

    // Complete: the confirm names A's own card; completing flips the header.
    await expect(page.getByText('1 card is not final: Edge A.')).toBeVisible();
    await page.locator('[data-complete-event]').click();
    await expect(page.getByText(/Not final yet: Edge A\./)).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Complete', exact: true }).click();
    await expect(page.locator('[data-event-status-chip]')).toHaveText(/Final/, { timeout: 20_000 });
    const after = (await (await apiA.get(`/api/group-posts/${gp}/scorecard`)).json()) as { scorecard: { participants: Array<{ participant: { profile_id: string }; scores: { status: string } }> } };
    expect(after.scorecard.participants.map(p => p.scores.status)).toEqual(['final', 'final']);
  } finally {
    if (eventId) {
      await apiA.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'completed', override: true } }).catch(() => null);
      await apiA.delete(`/api/sport-events/${eventId}`).catch(() => null);
    }
    await apiA.dispose();
    await apiB.dispose();
  }
});
