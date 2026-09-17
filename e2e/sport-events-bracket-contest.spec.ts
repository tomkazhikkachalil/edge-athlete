import { test, expect } from '@playwright/test';
import { adminClient, readErrorBody } from './helpers/qa-user';
import { cardRowFor, cleanupEvent, completeRound, createEvent, inviteAndAcceptAs, openEventSession, readScorecard, readView, roundTransition, scoreHoles, setGroups } from './helpers/sport-events';

type Detail = { contests: Array<{ id: string; status: string; stage: number | null; slot: number | null; sport_event?: { event_id: string; round_id: string } | null; participants: Array<{ id: string; entry_id: string; side: string | null; result: { score: number | null; provenance: string; payload?: Record<string, unknown> | null } | null }> }>; standings: Array<{ entry_id: string; rank: number }> };

/**
 * Events + formats leftovers, PR 11 — a bracketed MATCH event counts toward an
 * org golf BRACKET in one act. NEEDS MIGRATION 221 ON THE TARGET (self-skips
 * before). A owns a golf league with A, B, C, D entered and a four-player
 * bracket drawn (two stages: 1 v 4, 2 v 3 → the final). A hosts a two-round
 * bracketed singles match event for the league: the refusals by name (a
 * plain match event → `not_a_bracket`; three rounds against two stages →
 * `bracket_shape`), the link keeps the intent (`competition_id`, no contests
 * yet), round 1's groups in the org's slot order → go-live stamps both
 * stage-1 contests (in progress; a hand result 409 `from_event`), the
 * cards decide both matches, completion writes 1–0 league-verified and
 * fills the final; round 2's group → the final stamped onto stage 2;
 * completion crowns the champion; the unlink is refused once results exist.
 * `@mobile`: the counts-toward window lists the bracket.
 */
test('the bracket door: a bracketed match event links to the org bracket, go-live stamps each round onto its stage, completion crowns the champion @mobile', async ({ page }) => {
  test.setTimeout(240_000);
  const s = await openEventSession();
  const admin = adminClient();
  const probe = await admin.from('sport_events').select('competition_id').limit(1);
  test.skip(!!probe.error, 'sport_events.competition_id missing — run migration 221');
  test.skip(!s.apiC || !s.userC || !s.apiD || !s.userD, 'the four QA users are not minted — an older global setup');
  const apiC = s.apiC!; const userC = s.userC!; const apiD = s.apiD!; const userD = s.userD!;
  const { data: league, error } = await admin.from('leagues').insert({ name: `QA Bracket Door ${s.stamp}`, sport_key: 'golf', owner_profile_id: s.userA.id, visibility: 'public' }).select().single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  let eventId: string | null = null;
  let spareId: string | null = null;
  try {
    await admin.from('memberships').insert([
      { league_id: leagueId, profile_id: s.userA.id, kind: 'follow', role: 'owner', status: 'active', scope_type: 'org', scope_id: null },
      ...[s.userA.id, s.userB.id, userC.id, userD.id].map(profile_id => ({ league_id: leagueId, profile_id, kind: 'roster', role: 'member', status: 'active', scope_type: 'org', scope_id: null })),
    ]);
    const { data: season } = await admin.from('seasons').insert({ league_id: leagueId, label: '2026' }).select().single();
    const base = `/api/leagues/${leagueId}/competitions`;
    const created = await s.apiA.post(base, { data: { side: 'league', orgId: leagueId, seasonId: season!.id, sportKey: 'golf', name: 'Door Match Play', format: 'bracket', visibility: 'public' } });
    expect(created.ok(), await readErrorBody(created)).toBe(true);
    const compBody = (await created.json()) as { competition?: { id: string }; id?: string };
    const compId = compBody.competition?.id ?? compBody.id!;
    await admin.from('competitions').update({ status: 'active' }).eq('id', compId);
    const enter = async (profileId: string) => {
      const res = await s.apiA.post(`${base}/entries`, { data: { competitionId: compId, profileId } });
      expect(res.ok(), await readErrorBody(res)).toBe(true);
      const b = (await res.json()) as { entry?: { id: string }; id?: string };
      return b.entry?.id ?? b.id!;
    };
    const [eA, eB, eC, eD] = [await enter(s.userA.id), await enter(s.userB.id), await enter(userC.id), await enter(userD.id)];
    expect((await s.apiA.put(`${base}/${compId}/seeds`, { data: { competitionId: compId, entryIds: [eA, eB, eC, eD] } })).ok()).toBe(true);
    const gen = await s.apiA.post(`${base}/${compId}/bracket`, { data: { competitionId: compId, dryRun: false } });
    expect(gen.status(), await readErrorBody(gen)).toBe(201);
    const detail = async () => (await (await s.apiA.get(`${base}/${compId}`)).json()) as Detail;
    let d = await detail();
    const slot = (stage: number, k: number) => d.contests.find(c => c.stage === stage && c.slot === k)!;
    expect(slot(1, 1).participants.map(p => [p.side, p.entry_id]).sort()).toEqual([['away', eD], ['home', eA]]);
    expect(slot(1, 2).participants.map(p => [p.side, p.entry_id]).sort()).toEqual([['away', eC], ['home', eB]]);
    const rounds = (n: number) => Array.from({ length: n }, (_, i) => ({ scheduled_on: `2030-06-0${i + 1}`, course_name: 'QA Links', holes: 18 as const, starting_hole: 1 as const }));

    // The refusals by name: a plain match event; three rounds against two stages.
    const plain = await createEvent(s.apiA, { name: `QA Plain ${s.stamp}`, league_id: leagueId, format: 'match_gross', format_config: { match: { sides: 'singles', bracket: false } }, rounds: rounds(2) });
    spareId = plain.event.id;
    const notBracket = await s.apiA.put(`/api/sport-events/${plain.event.id}/contest`, { data: { competition_id: compId } });
    expect(notBracket.status()).toBe(400);
    expect(((await notBracket.json()) as { reason: string }).reason).toBe('not_a_bracket');
    await cleanupEvent(s.apiA, spareId); spareId = null;
    const three = await createEvent(s.apiA, { name: `QA Three ${s.stamp}`, league_id: leagueId, format: 'match_gross', format_config: { match: { sides: 'singles', bracket: true } }, rounds: rounds(3) });
    spareId = three.event.id;
    const shape = await s.apiA.put(`/api/sport-events/${three.event.id}/contest`, { data: { competition_id: compId } });
    expect(shape.status()).toBe(409);
    expect(((await shape.json()) as { reason: string }).reason).toBe('bracket_shape');
    await cleanupEvent(s.apiA, spareId); spareId = null;

    // The event: two rounds, bracketed singles, hosted for the league; the link keeps the intent — no contests yet.
    let v = await createEvent(s.apiA, { name: `QA Door ${s.stamp}`, league_id: leagueId, format: 'match_gross', format_config: { match: { sides: 'singles', bracket: true } }, rounds: rounds(2), publish: true });
    eventId = v.event.id;
    const [r1, r2] = v.rounds.map(r => r.id);
    const link = await s.apiA.put(`/api/sport-events/${eventId}/contest`, { data: { competition_id: compId } });
    expect(link.ok(), await readErrorBody(link)).toBe(true);
    expect((await link.json()) as object).toMatchObject({ counts_toward: { competition_id: compId, contests: [] }, stages: 2 });
    expect((await admin.from('sport_events').select('competition_id').eq('id', eventId).single()).data).toEqual({ competition_id: compId });
    v = await readView(s.apiA, eventId);
    expect(v.counts_toward).toMatchObject({ competition_id: compId, competition_name: 'Door Match Play', contests: [] });

    // The field: B, C, D join; round 1's draw in the org's slot order (A v D, B v C).
    for (const [api, user] of [[s.apiB, s.userB], [apiC, userC], [apiD, userD]] as const) await inviteAndAcceptAs(s.apiA, api, user, eventId);
    v = await readView(s.apiA, eventId);
    const idOf = (profileId: string) => v.participants.find(p => p.profile_id === profileId)!.id;
    await setGroups(s.apiA, eventId, r1, [
      { members: [{ participant_id: idOf(s.userA.id), side: 1 }, { participant_id: idOf(userD.id), side: 2 }] },
      { members: [{ participant_id: idOf(s.userB.id), side: 1 }, { participant_id: idOf(userC.id), side: 2 }] },
    ]);
    v = await roundTransition(s.apiA, eventId, r1, 'live', { today: '2030-06-01' });
    expect(v.rounds[0].status).toBe('live');
    const stage1 = await admin.from('contests').select('id, slot, sport_event_match_id, status').eq('competition_id', compId).eq('stage', 1).order('slot');
    expect(stage1.data!.map(c => [c.slot, c.status, !!c.sport_event_match_id])).toEqual([[1, 'in_progress', true], [2, 'in_progress', true]]);
    const byHand = await s.apiA.post(`${base}/${compId}/results`, { data: { contestId: slot(1, 1).id, results: [{ participantId: slot(1, 1).participants[0].id, score: 1 }] } });
    expect(byHand.status()).toBe(409);
    expect(((await byHand.json()) as { reason?: string }).reason).toBe('from_event');
    v = await readView(s.apiA, eventId);
    expect(v.counts_toward?.contests.map(c => c.round_id)).toEqual([r1, r1]);

    // The cards: A and B 4s, C and D 5s over ten holes — both matches 10&8.
    const card1 = await readScorecard(s.apiA, v.rounds[0].group_post_id as string);
    const holes = (strokes: number) => Array.from({ length: 10 }, (_, i) => ({ hole_number: i + 1, strokes }));
    await Promise.all([
      (async () => { await scoreHoles(s.apiA, cardRowFor(card1, s.userA.id), holes(4)); })(),
      (async () => { await scoreHoles(s.apiB, cardRowFor(card1, s.userB.id), holes(4)); })(),
    ]);
    await scoreHoles(apiC, cardRowFor(card1, userC.id), holes(5));
    await scoreHoles(apiD, cardRowFor(card1, userD.id), holes(5));
    v = await completeRound(s.apiA, eventId, r1);
    expect(v.rounds[0].status).toBe('completed');
    d = await detail();
    for (const [k, winner] of [[1, eA], [2, eB]] as const) {
      const c = slot(1, k);
      expect(c.status).toBe('completed');
      expect(c.sport_event?.event_id).toBe(eventId);
      expect(c.participants.find(p => p.entry_id === winner)?.result).toMatchObject({ score: 1, provenance: 'league_verified', payload: { match: { result: '10&8', won: true } } });
    }
    const final = slot(2, 1);
    expect(final.participants.map(p => p.entry_id).sort()).toEqual([eA, eB].sort());

    // Round 2: the final — A v B by slot; go-live stamps stage 2; A wins; the champion.
    await setGroups(s.apiA, eventId, r2, [{ members: [{ participant_id: idOf(s.userA.id), side: 1 }, { participant_id: idOf(s.userB.id), side: 2 }] }]);
    v = await roundTransition(s.apiA, eventId, r2, 'live', { today: '2030-06-02' });
    const stamped = await admin.from('contests').select('sport_event_match_id, status').eq('id', final.id).single();
    expect(stamped.data!.status).toBe('in_progress');
    expect(stamped.data!.sport_event_match_id).toBeTruthy();
    const card2 = await readScorecard(s.apiA, v.rounds[1].group_post_id as string);
    await scoreHoles(s.apiA, cardRowFor(card2, s.userA.id), holes(4));
    await scoreHoles(s.apiB, cardRowFor(card2, s.userB.id), holes(5));
    v = await completeRound(s.apiA, eventId, r2);
    expect(v.event.status).toBe('completed');
    d = await detail();
    expect(d.standings.find(r => r.entry_id === eA)?.rank).toBe(1);
    // The unlink is refused once results exist.
    const unlink = await s.apiA.put(`/api/sport-events/${eventId}/contest`, { data: { competition_id: null } });
    expect(unlink.status()).toBe(409);

    // The window at phone width lists the bracket (a fresh draft event, hosted for the league).
    const draft = await createEvent(s.apiA, { name: `QA Door Window ${s.stamp}`, league_id: leagueId, format: 'match_gross', format_config: { match: { sides: 'singles', bracket: true } }, rounds: rounds(2) });
    spareId = draft.event.id;
    await page.goto(`/events/${draft.event.id}`);
    await page.locator('[data-event-counts-toward-open]').click({ timeout: 20_000 });
    const select = page.locator('[data-counts-toward-select]');
    await expect(select).toBeVisible();
    await expect(select.locator('option', { hasText: 'Door Match Play' })).toHaveCount(1);
    await page.keyboard.press('Escape');
  } finally {
    await cleanupEvent(s.apiA, spareId);
    await cleanupEvent(s.apiA, eventId);
    await admin.from('leagues').delete().eq('id', leagueId);
    await s.dispose();
  }
});
