import { test, expect } from '@playwright/test';
import { adminClient, readErrorBody } from './helpers/qa-user';
import { cardRowFor, cleanupEvent, createEvent, finalizeCard, goLive, inviteAndAcceptAs, openEventSession, readScorecard, readView, scoreHoles, setGroups } from './helpers/sport-events';

/**
 * Events program, phase 4, PR 5 — recorders, at phone width on Chromium and
 * WebKit. NEEDS MIGRATION 214 ON THE TARGET (self-skips before) and the
 * four QA users. A golf event with `self_entry: false` (recorders only):
 * A hosts without playing; B and C play in two groups; D is invited AS A
 * RECORDER and does not play. B's own hole is refused by name (403); D
 * scores B and C through the API; on the phone D's live page shows the
 * recorder footer and the group switcher, and switching lands on C's
 * group; the roster shows the Recorder chip, a non-organizer may not name
 * one (403), the organizer un-names and re-names D; the overview names the
 * mode; a final card refuses the recorder (409).
 */
test('recorders: self_entry off, invite as recorder, the group switcher, the roster toggle @mobile', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const s = await openEventSession();
  const admin = adminClient();
  const probe = await admin.from('sport_events').select('self_entry').limit(1);
  test.skip(!!probe.error, 'sport_events.self_entry missing — run migration 214');
  test.skip(!s.apiC || !s.apiD || !s.userC || !s.userD, 'the four QA users are not minted — an older global setup');
  const apiC = s.apiC!;
  const apiD = s.apiD!;
  const userC = s.userC!;
  const userD = s.userD!;
  let eventId: string | null = null;
  try {
    const view = await createEvent(s.apiA, { name: `QA Recorder ${s.stamp}`, visibility: 'public', join_mode: 'invite', publish: true, host_plays: false, self_entry: false, round: { scheduled_on: '2030-06-01', course_name: 'QA Recorder Links', holes: 9, starting_hole: 1 } });
    eventId = view.event.id;
    expect(view.event).toMatchObject({ self_entry: false });
    const roundId = view.rounds[0].id;

    const { participantId: bId } = await inviteAndAcceptAs(s.apiA, s.apiB, s.userB, eventId);
    const { participantId: cId } = await inviteAndAcceptAs(s.apiA, apiC, userC, eventId);
    // D: invited AS A RECORDER, accepts, and does not play.
    const inv = await s.apiA.post(`/api/sport-events/${eventId}/participants`, { data: { profile_ids: [userD.id], recorder: true } });
    expect(inv.ok(), await readErrorBody(inv)).toBe(true);
    const asD = await readView(apiD, eventId);
    expect(asD.viewer.participant_id, 'D has a row').toBeTruthy();
    const dId = asD.viewer.participant_id!;
    const acc = await apiD.post(`/api/sport-events/${eventId}/participants/${dId}`, { data: { action: 'accept' } });
    expect(acc.ok(), await readErrorBody(acc)).toBe(true);
    const notPlaying = await apiD.patch(`/api/sport-events/${eventId}/participants/${dId}`, { data: { playing: false } });
    expect(notPlaying.ok(), await readErrorBody(notPlaying)).toBe(true);
    let dView = await readView(apiD, eventId);
    expect(dView.viewer).toMatchObject({ participant_status: 'accepted', playing: false, recorder: true });
    expect(dView.participants.find(p => p.profile_id === userD.id)).toMatchObject({ recorder: true });
    expect(dView.counts.playing).toBe(2);

    // A non-organizer may not name a recorder; the organizer un-names and re-names D.
    expect((await s.apiB.patch(`/api/sport-events/${eventId}/participants/${cId}`, { data: { recorder: true } })).status()).toBe(403);
    const off = await s.apiA.patch(`/api/sport-events/${eventId}/participants/${dId}`, { data: { recorder: false } });
    expect(off.ok(), await readErrorBody(off)).toBe(true);
    expect((await readView(apiD, eventId)).viewer.recorder).toBe(false);
    const on = await s.apiA.patch(`/api/sport-events/${eventId}/participants/${dId}`, { data: { recorder: true } });
    expect(on.ok(), await readErrorBody(on)).toBe(true);

    // Two groups: B alone in "Early", C alone in "Late"; go live.
    await setGroups(s.apiA, eventId, roundId, [{ name: 'Early', members: [bId] }, { name: 'Late', members: [cId] }]);
    await goLive(s.apiA, eventId, '2030-06-01');
    const live = await readView(s.apiA, eventId);
    const gp = live.rounds[0].group_post_id;
    expect(gp, 'the live round has a group post').toBeTruthy();
    const card = await readScorecard(apiD, gp!);
    const bCard = cardRowFor(card, s.userB.id);
    const cCard = cardRowFor(card, userC.id);

    // B's own hole under self_entry false → 403 by name.
    const own = await s.apiB.post(`/api/golf/scorecards/${bCard}/scores`, { data: { scores: [{ hole_number: 1, strokes: 4 }] } });
    expect(own.status(), await readErrorBody(own)).toBe(403);
    expect(await readErrorBody(own)).toMatch(/recorder/i);
    // D (not playing, no card) scores B and C; the organizer scores too.
    await scoreHoles(apiD, bCard, [{ hole_number: 1, strokes: 4 }, { hole_number: 2, strokes: 5 }]);
    await scoreHoles(apiD, cCard, [{ hole_number: 1, strokes: 3 }]);
    await scoreHoles(s.apiA, cCard, [{ hole_number: 2, strokes: 4 }]);

    // D's phone: the recorder footer, the switcher, "Late" lands on C's column.
    const ctxD = await browser.newContext({ storageState: 'e2e/.auth/state-d.json' });
    try {
      const pageD = await ctxD.newPage();
      await pageD.goto(`/live/${gp}`);
      await expect(pageD.locator('[data-gsc-footer="recorder"]')).toBeVisible({ timeout: 20_000 });
      await expect(pageD.locator('[data-group-switcher]')).toBeVisible();
      await expect(pageD.locator(`[data-gsc-cell="${s.userB.id}:1"]`)).toHaveText(/4/);
      const lateId = live.groups.find(g => g.sport_event_round_id === roundId && g.name === 'Late')?.id;
      expect(lateId, 'the Late group id').toBeTruthy();
      await pageD.locator(`[data-group-pill="${lateId}"]`).click();
      await expect(pageD.locator(`[data-gsc-cell="${userC.id}:1"]`)).toHaveText(/3/, { timeout: 20_000 });
      await expect(pageD.locator(`[data-gsc-cell="${s.userB.id}:1"]`)).toHaveCount(0);
      // The recorder enters C's hole 3 with no partner confirm.
      await pageD.locator(`[data-gsc-cell="${userC.id}:3"]`).click();
      await expect(pageD.locator(`[data-gsc-editor="${userC.id}:3"]`)).toBeVisible();
    } finally {
      await ctxD.close();
    }

    // The roster chip + the overview line, on A's phone.
    await page.goto(`/events/${eventId}?tab=players`);
    await expect(page.locator(`[data-event-player="${userD.id}"] [data-event-player-recorder]`)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(`[data-event-recorder-toggle="${userD.id}"]`)).toBeChecked();
    await page.goto(`/events/${eventId}?tab=overview`);
    await expect(page.locator('[data-event-recording-line]')).toHaveText(/recorder enters/i, { timeout: 20_000 });

    // A final card refuses the recorder (organizers only).
    await scoreHoles(apiD, bCard, Array.from({ length: 7 }, (_, i) => ({ hole_number: i + 3, strokes: 4 })));
    await finalizeCard(s.apiA, eventId, bCard);
    const late = await apiD.post(`/api/golf/scorecards/${bCard}/scores`, { data: { scores: [{ hole_number: 1, strokes: 5 }] } });
    expect(late.status(), await readErrorBody(late)).toBe(409);
    dView = await readView(apiD, eventId);
    expect(dView.event.status).toBe('live');
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await s.dispose();
  }
});
