import { test, expect } from '@playwright/test';
import { adminClient, readErrorBody } from './helpers/qa-user';
import { cleanupEvent, completeRound, createEvent, inviteAndAcceptAs, openEventSession, readView, setGroups, startRound } from './helpers/sport-events';

/**
 * Events program, phase 3, PR 10 — a bracket at phone width on Chromium
 * and WebKit. NEEDS MIGRATION 212 AND THE FOUR QA USERS (self-skips
 * without either). A hosts a singles gross bracket over two rounds on
 * the SAME day (legal: the date order is strict). Round 1: A vs B, C vs D
 * — B and D concede their matches, round 1 completes (no override). The
 * Groups tab on round 2: "Fill from winners" → A vs C with the sides set
 * → Save. Round 2 starts; `?round=bracket` draws two columns
 * ("Semifinals" · "Final"), the decided slots with the winner bold; the
 * organizer decides the Final for C, the round completes, the bracket
 * names its winner.
 */
test('a bracket: same-day rounds, Fill from winners, the bracket view, the Final\'s winner @mobile', async ({ page }) => {
  test.setTimeout(150_000); // four players, two events / two rounds against prod — 58 s on Chromium, over the default minute on WebKit
  const s = await openEventSession();
  const admin = adminClient();
  const probe = await admin.from('sport_event_matches').select('id').limit(1);
  test.skip(!!probe.error, 'sport_event_matches missing — run migration 212');
  test.skip(!s.apiC || !s.apiD || !s.userC || !s.userD, 'the four QA users are not minted — an older global setup');
  const apiC = s.apiC!;
  const apiD = s.apiD!;
  const userC = s.userC!;
  const userD = s.userD!;
  let eventId: string | null = null;
  try {
    const view = await createEvent(s.apiA, { name: `QA Bracket ${s.stamp}`, publish: true, format: 'match_gross', format_config: { match: { sides: 'singles', bracket: true } }, rounds: [
      { scheduled_on: '2030-06-01', course_name: 'QA Bracket Links', holes: 9, starting_hole: 1 },
      { scheduled_on: '2030-06-01', course_name: 'QA Bracket Links', holes: 9, starting_hole: 1 },
    ] });
    eventId = view.event.id;
    expect(view.event.match).toMatchObject({ sides: 'singles', bracket: true });
    const [r1, r2] = view.rounds.map(r => r.id);
    const { participantId: bId, hostRowId: aId } = await inviteAndAcceptAs(s.apiA, s.apiB, s.userB, eventId);
    const { participantId: cId } = await inviteAndAcceptAs(s.apiA, apiC, userC, eventId);
    const { participantId: dId } = await inviteAndAcceptAs(s.apiA, apiD, userD, eventId);

    // Round 1: two matches; B and D concede; the round completes without the override.
    await setGroups(s.apiA, eventId, r1, [{ members: [aId, bId] }, { members: [cId, dId] }]);
    await startRound(s.apiA, eventId, r1, '2030-06-01');
    const r1Matches = ((await (await s.apiA.get(`/api/sport-events/${eventId}/matches?round=${r1}`)).json()) as { matches: Array<{ id: string; group: { sequence: number }; version: number }> }).matches;
    expect(r1Matches.map(m => m.group.sequence)).toEqual([1, 2]);
    const cB = await s.apiB.post(`/api/sport-events/${eventId}/matches/${r1Matches[0].id}/concede`, { data: { hole: null, side: 2, version: 0 } });
    expect(cB.status(), await readErrorBody(cB)).toBe(200);
    const cD = await apiD.post(`/api/sport-events/${eventId}/matches/${r1Matches[1].id}/concede`, { data: { hole: null, side: 2, version: 0 } });
    expect(cD.status(), await readErrorBody(cD)).toBe(200);
    const after1 = await completeRound(s.apiA, eventId, r1, false);
    expect(after1.event.status).toBe('live');
    expect(after1.rounds.map(r => r.status)).toEqual(['completed', 'scheduled']);

    // Round 2's draw from the winners, on the Groups tab.
    await page.goto(`/events/${eventId}?tab=groups&round=${r2}`);
    await expect(page.locator(`[data-event-groups-editor="${r2}"]`)).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-groups-fill-winners]').click();
    await expect(page.locator('[data-groups-group="1"]')).toBeVisible();
    await expect(page.locator('[data-groups-group]')).toHaveCount(1);
    await expect(page.locator(`[data-groups-side="${aId}"]`)).toHaveAttribute('data-groups-side-value', '1');
    await expect(page.locator(`[data-groups-side="${cId}"]`)).toHaveAttribute('data-groups-side-value', '2');
    await expect(page.locator('[data-groups-incomplete]')).toHaveCount(0);
    await page.locator('[data-groups-save]').click();
    await expect(page.locator('[data-groups-notice]')).toHaveText('Groups saved.', { timeout: 20_000 });
    const saved = await readView(s.apiA, eventId);
    const final = saved.groups.find(g => g.sport_event_round_id === r2)!;
    expect(final.members.map(m => [m.participant_id, m.side])).toEqual([[aId, 1], [cId, 2]]);

    // The Final starts; the bracket view; the organizer decides it for C; the round completes; the winner is named.
    await startRound(s.apiA, eventId, r2, '2030-06-01');
    await page.goto(`/events/${eventId}?tab=matches&round=bracket`);
    await expect(page.locator('[data-bracket-view]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-round-switch="bracket"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-bracket-column]')).toHaveCount(2);
    await expect(page.locator('[data-bracket-column="1"] h3')).toContainText('Semifinals');
    await expect(page.locator('[data-bracket-column="2"] h3')).toContainText('Final');
    await expect(page.locator('[data-bracket-slot="1:1"]')).toContainText('conceded');
    await expect(page.locator('[data-bracket-slot="1:1"] [data-bracket-side="1"]')).toHaveClass(/font-bold/);
    await expect(page.locator('[data-bracket-slot="2:1"] [data-bracket-side="2"]')).not.toHaveClass(/font-bold/);
    await expect(page.locator('[data-bracket-winner]')).toHaveCount(0);
    const m2 = ((await (await s.apiA.get(`/api/sport-events/${eventId}/matches?round=${r2}`)).json()) as { matches: Array<{ id: string; version: number }> }).matches[0];
    const decided = await s.apiA.post(`/api/sport-events/${eventId}/matches/${m2.id}/decide`, { data: { winner_side: 2, version: m2.version } });
    expect(decided.status(), await readErrorBody(decided)).toBe(200);
    const done = await completeRound(s.apiA, eventId, r2, false);
    expect(done.event.status).toBe('completed');
    await page.reload();
    await expect(page.locator('[data-bracket-winner]')).toContainText('wins the bracket', { timeout: 20_000 });
    await expect(page.locator('[data-bracket-slot="2:1"] [data-bracket-side="2"]')).toHaveClass(/font-bold/);
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await s.dispose();
  }
});
