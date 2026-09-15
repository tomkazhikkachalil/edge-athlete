import { test, expect } from '@playwright/test';
import { adminClient, readErrorBody } from './helpers/qa-user';
import { cardRowFor, cleanupEvent, createEvent, inviteAndAcceptAs, openEventSession, readScorecard, scoreHoles, startRound } from './helpers/sport-events';

/**
 * Events program, phase 3, PR 9 — pairs at phone width on Chromium and
 * WebKit. NEEDS MIGRATION 212 AND THE FOUR QA USERS (self-skips without
 * either). Four-ball gross: A hosts, invites B, C and D; the Groups tab's
 * Side control (the position's side by default: A and B side 1, C and D
 * side 2) saves the draw; the round starts; the group card shows four
 * columns; hole 1 halved on the better balls, hole 2 to C & D → "C & D
 * 1 UP thru 2". Foursomes: the same four, two columns headed by the
 * pairs; the captain's card counts and the partner's is never read.
 */
test('pairs: four-ball better ball and foursomes on the captain\'s card, the Side control @mobile', async ({ page }) => {
  const s = await openEventSession();
  const admin = adminClient();
  const probe = await admin.from('sport_event_matches').select('id').limit(1);
  test.skip(!!probe.error, 'sport_event_matches missing — run migration 212');
  test.skip(!s.apiC || !s.apiD || !s.userC || !s.userD, 'the four QA users are not minted — an older global setup');
  const apiC = s.apiC!;
  const apiD = s.apiD!;
  const userC = s.userC!;
  const userD = s.userD!;
  let fourballId: string | null = null;
  let foursomesId: string | null = null;
  try {
    // Four-ball: the draw through the Groups tab's Side control.
    const fb = await createEvent(s.apiA, { name: `QA Fourball ${s.stamp}`, publish: true, format: 'match_gross', format_config: { match: { sides: 'fourball' } }, round: { scheduled_on: '2030-06-01', course_name: 'QA Pairs Links', holes: 9, starting_hole: 1 } });
    fourballId = fb.event.id;
    const r1 = fb.rounds[0].id;
    const { participantId: bId, hostRowId: aId } = await inviteAndAcceptAs(s.apiA, s.apiB, s.userB, fourballId);
    const { participantId: cId } = await inviteAndAcceptAs(s.apiA, apiC, userC, fourballId);
    const { participantId: dId } = await inviteAndAcceptAs(s.apiA, apiD, userD, fourballId);

    await page.goto(`/events/${fourballId}?tab=groups`);
    await expect(page.locator(`[data-event-groups-editor="${r1}"]`)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-groups-match-hint]')).toContainText('Four-ball');
    await expect(page.locator('[data-groups-by-standing]')).toHaveCount(0);
    await page.locator('[data-groups-add]').click();
    for (const id of [aId, bId, cId, dId]) {
      await page.locator(`[data-groups-pool="${id}"] select`).selectOption({ index: 1 });
    }
    await expect(page.locator('[data-groups-incomplete]')).toHaveCount(0);
    for (const [id, side] of [[aId, '1'], [bId, '1'], [cId, '2'], [dId, '2']] as const) {
      await expect(page.locator(`[data-groups-side="${id}"]`)).toHaveAttribute('data-groups-side-value', side);
    }
    // Move D to side 1 → three on a side, the group is flagged; back to side 2 → clean.
    await page.locator(`[data-groups-side="${dId}"] [data-groups-side-pick="1"]`).click();
    await expect(page.locator('[data-groups-incomplete="1"]')).toContainText('At most 2 a side');
    await page.locator(`[data-groups-side="${dId}"] [data-groups-side-pick="2"]`).click();
    await expect(page.locator('[data-groups-incomplete]')).toHaveCount(0);
    await page.locator('[data-groups-save]').click();
    await expect(page.locator('[data-groups-notice]')).toHaveText('Groups saved.', { timeout: 20_000 });
    const savedView = (await (await s.apiA.get(`/api/sport-events/${fourballId}`)).json()) as { groups: Array<{ members: Array<{ participant_id: string; side: number | null }> }> };
    expect(savedView.groups[0].members.map(m => [m.participant_id, m.side])).toEqual([[aId, 1], [bId, 1], [cId, 2], [dId, 2]]);

    // The round starts; four columns; the better ball per side.
    const live = await startRound(s.apiA, fourballId, r1, '2030-06-01');
    const gp = live.rounds[0].group_post_id as string;
    await page.goto(`/live/${gp}`);
    await expect(page.locator('[data-group-score-card]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-gsc-col]')).toHaveCount(4);
    await expect(page.locator('[data-match-strip-summary]')).toHaveText('Not started');
    const card = await readScorecard(s.apiA, gp);
    const row = (u: { id: string }) => cardRowFor(card, u.id);
    await scoreHoles(s.apiA, row(s.userA), [{ hole_number: 1, strokes: 5 }, { hole_number: 2, strokes: 5 }]);
    await scoreHoles(s.apiB, row(s.userB), [{ hole_number: 1, strokes: 4 }, { hole_number: 2, strokes: 5 }]);
    await scoreHoles(apiC, row(userC), [{ hole_number: 1, strokes: 4 }, { hole_number: 2, strokes: 4 }]);
    await scoreHoles(apiD, row(userD), [{ hole_number: 1, strokes: 6 }, { hole_number: 2, strokes: 5 }]);
    const m = (await (await s.apiA.get(`/api/sport-events/${fourballId}/matches`)).json()) as { matches: Array<{ line: string; state: { up: number; thru: number; summary: string; holes: Array<{ sideScore: Record<string, number | null>; winner: number | null }> } }> };
    expect(m.matches[0].line).toMatch(/ & .* vs .* & /);
    expect(m.matches[0].state.holes.map(h => [h.sideScore['1'], h.sideScore['2'], h.winner])).toEqual([[4, 4, null], [5, 4, 2]]);
    expect(m.matches[0].state).toMatchObject({ up: -1, thru: 2 });
    expect(m.matches[0].state.summary).toMatch(/1 UP thru 2$/);
    await page.reload();
    await expect(page.locator('[data-match-strip-summary]')).toHaveText(/1 UP thru 2$/, { timeout: 20_000 });

    // Foursomes: two columns headed by the pairs; the captain's card counts, the partner's is never read.
    const fs = await createEvent(s.apiA, { name: `QA Foursomes ${s.stamp}`, publish: true, format: 'match_gross', format_config: { match: { sides: 'foursomes' } }, round: { scheduled_on: '2030-06-01', course_name: 'QA Pairs Links', holes: 9, starting_hole: 1 } });
    foursomesId = fs.event.id;
    const r2 = fs.rounds[0].id;
    const { participantId: b2, hostRowId: a2 } = await inviteAndAcceptAs(s.apiA, s.apiB, s.userB, foursomesId);
    const { participantId: c2 } = await inviteAndAcceptAs(s.apiA, apiC, userC, foursomesId);
    const { participantId: d2 } = await inviteAndAcceptAs(s.apiA, apiD, userD, foursomesId);
    const put = await s.apiA.put(`/api/sport-events/${foursomesId}/rounds/${r2}/groups`, { data: { groups: [{ members: [{ participant_id: a2, side: 1 }, { participant_id: b2, side: 1 }, { participant_id: c2, side: 2 }, { participant_id: d2, side: 2 }] }] } });
    expect(put.ok(), await readErrorBody(put)).toBe(true);
    const live2 = await startRound(s.apiA, foursomesId, r2, '2030-06-01');
    const gp2 = live2.rounds[0].group_post_id as string;
    await page.goto(`/live/${gp2}`);
    await expect(page.locator('[data-group-score-card]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-gsc-col]')).toHaveCount(2);
    await expect(page.locator(`[data-gsc-col="${s.userA.id}"]`)).toContainText('&');
    await expect(page.locator(`[data-gsc-col="${userC.id}"]`)).toContainText('&');
    const card2 = await readScorecard(s.apiA, gp2);
    await scoreHoles(s.apiA, cardRowFor(card2, s.userA.id), [{ hole_number: 1, strokes: 4 }]);
    await scoreHoles(s.apiB, cardRowFor(card2, s.userB.id), [{ hole_number: 1, strokes: 3 }]); // the partner's card is never read
    await scoreHoles(apiC, cardRowFor(card2, userC.id), [{ hole_number: 1, strokes: 5 }]);
    const m2 = (await (await s.apiA.get(`/api/sport-events/${foursomesId}/matches`)).json()) as { matches: Array<{ sides: Array<{ card_participant_ids: string[] }>; state: { up: number; holes: Array<{ sideScore: Record<string, number | null> }> } }> };
    expect(m2.matches[0].sides.map(x => x.card_participant_ids)).toEqual([[a2], [c2]]);
    expect(m2.matches[0].state.holes[0].sideScore).toEqual({ '1': 4, '2': 5 });
    expect(m2.matches[0].state.up).toBe(1);
  } finally {
    await cleanupEvent(s.apiA, fourballId);
    await cleanupEvent(s.apiA, foursomesId);
    await s.dispose();
  }
});
