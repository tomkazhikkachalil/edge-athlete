import { test, expect } from '@playwright/test';
import { cardRowFor, cleanupEvent, createEvent, inviteAndAccept, openEventSession, readScorecard, scoreHoles, setGroups, startRound } from './helpers/sport-events';

/**
 * Events program, phase 4, PR 1 — anonymous reading, at phone width on
 * Chromium and WebKit. A PUBLIC event's live round is a place anyone can
 * watch: the scorecard GET answers a signed-out reader (a private event's
 * round stays a 404), /live/[gp] renders without a session, the header
 * offers "Log in to join", and a name on the roster opens the in-event
 * sheet — the masked name ("Edge B.": the QA users are private) with no
 * profile link. Signed in, A's sheet shows this event's line.
 */
const ANON = { cookies: [], origins: [] };

test('anonymous reading: the public round, the live page, "Log in to join", the player sheet @mobile', async ({ page, browser }) => {
  const s = await openEventSession();
  let publicId: string | null = null;
  let privateId: string | null = null;
  try {
    const pub = await createEvent(s.apiA, { name: `QA Anon ${s.stamp}`, visibility: 'public', publish: true, round: { scheduled_on: '2030-06-01', course_name: 'QA Anon Links', holes: 9, starting_hole: 1 } });
    publicId = pub.event.id;
    const { participantId: bId, hostRowId: aId } = await inviteAndAccept(s, publicId);
    await setGroups(s.apiA, publicId, pub.rounds[0].id, [{ members: [aId, bId] }]);
    const live = await startRound(s.apiA, publicId, pub.rounds[0].id, '2030-06-01');
    const gp = live.rounds[0].group_post_id as string;
    const card = await readScorecard(s.apiA, gp);
    await scoreHoles(s.apiA, cardRowFor(card, s.userA.id), [{ hole_number: 1, strokes: 4 }]);
    const priv = await createEvent(s.apiA, { name: `QA Anon Private ${s.stamp}`, visibility: 'private', publish: true, round: { scheduled_on: '2030-06-01', course_name: 'QA Anon Links', holes: 9, starting_hole: 1 } });
    privateId = priv.event.id;
    await inviteAndAccept(s, privateId);
    const privLive = await startRound(s.apiA, privateId, priv.rounds[0].id, '2030-06-01');
    const privGp = privLive.rounds[0].group_post_id as string;

    // The API: a public round answers a stranger; a private one is a 404, never a 401 that confirms it exists.
    const pubRes = await s.anon.get(`/api/group-posts/${gp}/scorecard`);
    expect(pubRes.status()).toBe(200);
    expect(((await pubRes.json()) as { scorecard: { participants: unknown[] } }).scorecard.participants).toHaveLength(2);
    expect((await s.anon.get(`/api/group-posts/${privGp}/scorecard`)).status()).toBe(404);

    // The pages, signed out.
    const ctx = await browser.newContext({ storageState: ANON });
    try {
      const anon = await ctx.newPage();
      await anon.goto(`/live/${gp}`);
      await expect(anon.locator('[data-live-back]')).toBeVisible({ timeout: 20_000 });
      await expect(anon).toHaveURL(new RegExp(`/live/${gp}`));
      await anon.goto(`/events/${publicId}?tab=players`);
      // The join control renders in the header AND on the players tab — the first is the header's.
      await expect(anon.locator('[data-event-join="signin"]').first()).toBeVisible({ timeout: 20_000 });
      await anon.locator(`[data-event-player-open="${s.userB.id}"]`).click();
      const sheet = anon.locator('[data-larger-window="event-player"]');
      await expect(sheet.locator(`[data-event-player-sheet="${s.userB.id}"]`)).toBeVisible();
      await expect(sheet).toContainText('Edge B.');
      await expect(sheet.locator('[data-event-player-profile]')).toHaveCount(0);
      await expect(sheet.locator('[data-event-player-private]')).toBeVisible();
      await anon.keyboard.press('Escape');
      await anon.locator('[data-event-join="signin"]').first().click();
      await expect(anon).toHaveURL(/\/\?next=%2Fevents%2F/, { timeout: 20_000 });
      // A private event stays unavailable signed out.
      await anon.goto(`/live/${privGp}`);
      await expect(anon).toHaveURL(/\/\?next=%2Flive%2F/, { timeout: 20_000 });
    } finally {
      await ctx.close();
    }

    // Signed in as A: the sheet carries this event's line for A (hole 1 scored).
    await page.goto(`/events/${publicId}?tab=players`);
    await page.locator(`[data-event-player-open="${s.userA.id}"]`).click();
    const mine = page.locator('[data-larger-window="event-player"]');
    await expect(mine.locator('[data-event-player-line]')).toContainText('Thru', { timeout: 20_000 });
    await expect(mine.locator('[data-event-player-line]')).toContainText('1');
  } finally {
    await cleanupEvent(s.apiA, publicId);
    await cleanupEvent(s.apiA, privateId);
    await s.dispose();
  }
});
