import { test, expect } from '@playwright/test';
import { cardRowFor, cleanupEvent, createEvent, goLive, inviteAndAccept, openEventSession, readScorecard, setGroups } from './helpers/sport-events';
import { readErrorBody } from './helpers/qa-user';

/**
 * Events program, phase 2b (B3) — the per-hole compare-and-set on the
 * group card. B goes OFFLINE and scores holes 2, 3 and 4; meanwhile A
 * (the organizer) posts B's hole 3 = 6 through the API. B comes back:
 * holes 2 and 4 land (the false-conflict regression — the old card-stamp
 * guard conflicted every queued hole), hole 3 asks. The dialog names both
 * scores; Keep mine writes B's 4 at version 2 (a real CAS). Then A posts
 * hole 3 = 7 again; B re-scores hole 3 against the version the card showed
 * (2) → a fresh conflict → Keep theirs leaves A's 7 at version 3. Tagged
 * @mobile on Chromium and WebKit at 390 × 844.
 */
test('group card: offline holes land beside a partner\'s write; a real conflict asks; keep mine is a CAS; keep theirs yields @mobile', async ({ browser }) => {
  const s = await openEventSession();
  let eventId: string | null = null;
  try {
    const view = await createEvent(s.apiA, { name: `QA Conflict ${s.stamp}`, publish: true, round: { scheduled_on: '2030-06-01', course_name: 'QA Conflict Links', holes: 9 } });
    eventId = view.event.id;
    const roundId = view.rounds[0].id;
    const { participantId: rowBEvent, hostRowId } = await inviteAndAccept(s, eventId);
    await setGroups(s.apiA, eventId, roundId, [{ members: [hostRowId, rowBEvent] }]);
    const live = await goLive(s.apiA, eventId, '2030-06-01');
    const gp = live.rounds[0].group_post_id as string;
    const card0 = await readScorecard(s.apiA, gp);
    const rowB = cardRowFor(card0, s.userB.id);

    const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ctxB.newPage();
      await page.goto(`/live/${gp}`);
      await expect(page.locator('[data-group-score-card]')).toBeVisible({ timeout: 20_000 });
      const cell = (hole: number) => page.locator(`[data-gsc-cell="${s.userB.id}:${hole}"]`);

      // Offline: holes 2, 3, 4 queue (the wheel rests on par = 4).
      await ctxB.setOffline(true);
      await cell(2).click();
      await expect(page.locator(`[data-gsc-editor="${s.userB.id}:2"]`)).toBeVisible();
      await page.locator('[data-gsc-save]').click(); // → hole 3
      await page.locator('[data-gsc-save]').click(); // → hole 4
      await page.locator('[data-gsc-save]').click(); // → hole 5
      for (const h of [2, 3, 4]) await expect(cell(h)).toHaveAttribute('data-gsc-state', 'pending');

      // Meanwhile A posts B's hole 3 = 6 through the API (the organizer's right).
      const byA = await s.apiA.post(`/api/golf/scorecards/${rowB}/scores`, { data: { scores: [{ hole_number: 3, strokes: 6 }] } });
      expect(byA.status(), await readErrorBody(byA)).toBe(201);

      // Back online: 2 and 4 land, 3 conflicts.
      await ctxB.setOffline(false);
      await expect(cell(2)).toHaveAttribute('data-gsc-state', 'saved', { timeout: 30_000 });
      await expect(cell(4)).toHaveAttribute('data-gsc-state', 'saved', { timeout: 30_000 });
      await expect(cell(3)).toHaveAttribute('data-gsc-state', 'conflict', { timeout: 30_000 });

      // The dialog names both scores; Keep mine writes B's 4 at version 2.
      await page.locator('[data-gsc-editor]').getByRole('button', { name: 'Close the editor' }).click();
      await cell(3).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('They have 6 on hole 3');
      await expect(dialog).toContainText('you entered 4');
      await dialog.getByRole('button', { name: 'Keep mine' }).click();
      await expect(cell(3)).toHaveAttribute('data-gsc-state', 'saved', { timeout: 30_000 });
      await expect(cell(3)).toHaveText(/4/);
      await expect.poll(async () => {
        const card = await readScorecard(s.apiA, gp);
        return card.participants.find(p => p.participant.profile_id === s.userB.id)!.scores?.hole_scores?.find(h => h.hole_number === 3) ?? null;
      }, { timeout: 15_000 }).toMatchObject({ strokes: 4, version: 2 });

      // A fresh conflict: A posts 7 (version 3); B re-scores hole 3 against the card's 2 → asks → Keep theirs.
      const again = await s.apiA.post(`/api/golf/scorecards/${rowB}/scores`, { data: { scores: [{ hole_number: 3, strokes: 7 }] } });
      expect(again.status(), await readErrorBody(again)).toBe(201);
      await cell(3).click();
      await expect(page.locator(`[data-gsc-editor="${s.userB.id}:3"]`)).toBeVisible();
      await page.locator('[data-gsc-save]').click();
      await expect(cell(3)).toHaveAttribute('data-gsc-state', 'conflict', { timeout: 30_000 });
      await page.locator('[data-gsc-editor]').getByRole('button', { name: 'Close the editor' }).click();
      await cell(3).click();
      await expect(page.getByRole('dialog')).toContainText('They have 7 on hole 3');
      await page.getByRole('dialog').getByRole('button', { name: 'Keep theirs' }).click();
      await expect(cell(3)).toHaveAttribute('data-gsc-state', 'saved', { timeout: 30_000 });
      await expect(cell(3)).toHaveText(/7/);
    } finally {
      await ctxB.close();
    }

    const card = await readScorecard(s.apiA, gp);
    const holes = card.participants.find(p => p.participant.profile_id === s.userB.id)!.scores!.hole_scores!;
    expect(holes.find(h => h.hole_number === 2)).toMatchObject({ strokes: 4, version: 1 });
    expect(holes.find(h => h.hole_number === 3)).toMatchObject({ strokes: 7, version: 3 });
    expect(holes.find(h => h.hole_number === 4)).toMatchObject({ strokes: 4, version: 1 });
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await s.dispose();
  }
});
