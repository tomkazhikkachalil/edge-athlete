import { test, expect } from '@playwright/test';
import { adminClient, readErrorBody } from './helpers/qa-user';
import { cardRowFor, cleanupEvent, completeRound, createEvent, inviteAndAccept, openEventSession, readScorecard, readView, scoreHoles, setGroups, startRound } from './helpers/sport-events';

/**
 * Events program, phase 3 (PR 4) — the match-play vocabulary. A creates a
 * singles gross match event carrying `format_config.match`; the strict
 * parser refuses a cut on a match format, a match config on a stroke
 * format and a bad `sides`, each by name; the allowance changes through
 * the PATCH; the groups PUT takes a side per member — derived from the
 * position for a plain id, or sent as {participant_id, side} — and a
 * stroke event refuses a `side` by name; switching families without a
 * fitting format_config is refused (`format_config_stale`); an org event
 * on a match format cannot count toward a competition (`not_stroke_play`).
 * Self-skips before 212 (`sport_event_group_members.side`).
 */
test('sport events API: match play — the vocabulary, the config refusals, sides on the draw, not_stroke_play', async () => {
  const s = await openEventSession();
  const admin = adminClient();
  const probe = await admin.from('sport_event_group_members').select('side').limit(1);
  test.skip(!!probe.error, 'sport_event_group_members.side missing — run migration 212');
  let eventId: string | null = null;
  let strokeId: string | null = null;
  let clubId: string | null = null;
  try {
    // The refusals, each by name, before anything exists.
    const cutOnMatch = await s.apiA.post('/api/sport-events', { data: { name: `QA Match Bad ${s.stamp}`, format: 'match_gross', format_config: { cut: { after_round: 1, top_n: 4 } }, rounds: [{ scheduled_on: '2030-06-01', course_name: 'QA Links' }, { scheduled_on: '2030-06-02', course_name: 'QA Links' }] } });
    expect(cutOnMatch.status()).toBe(400);
    expect((await cutOnMatch.json()).error).toBe('format_config.cut is not allowed on a match-play format');
    const matchOnStroke = await s.apiA.post('/api/sport-events', { data: { name: `QA Match Bad ${s.stamp}`, format: 'stroke_net', format_config: { match: { sides: 'singles' } }, round: { scheduled_on: '2030-06-01', course_name: 'QA Links' } } });
    expect(matchOnStroke.status()).toBe(400);
    expect((await matchOnStroke.json()).error).toBe('format_config.match is only allowed on a match-play format');
    const badSides = await s.apiA.post('/api/sport-events', { data: { name: `QA Match Bad ${s.stamp}`, format: 'match_net', format_config: { match: { sides: 'scramble' } }, round: { scheduled_on: '2030-06-01', course_name: 'QA Links' } } });
    expect(badSides.status()).toBe(400);
    expect((await badSides.json()).error).toContain('format_config.match.sides');

    // A singles gross match event: the view carries the defaults-filled `match`.
    const view = await createEvent(s.apiA, { name: `QA Match ${s.stamp}`, publish: true, format: 'match_gross', format_config: { match: { sides: 'singles' } }, round: { scheduled_on: '2030-06-01', course_name: 'QA Match Links', holes: 9, starting_hole: 1 } });
    eventId = view.event.id;
    expect(view.event.format).toBe('match_gross');
    expect(view.event.match).toEqual({ sides: 'singles', bracket: false, allowance: 100 });
    const roundId = view.rounds[0].id;

    // The allowance changes through the PATCH; the shape stays.
    const patched = await s.apiA.patch(`/api/sport-events/${eventId}`, { data: { format_config: { match: { sides: 'singles', bracket: false, allowance: 80 } } } });
    expect(patched.status(), await readErrorBody(patched)).toBe(200);
    expect(((await patched.json()) as { event: { match: { allowance: number } } }).event.match.allowance).toBe(80);

    // Sides on the draw: plain ids derive from the position; objects are taken as sent.
    const { participantId: bId, hostRowId: aId } = await inviteAndAccept(s, eventId);
    const derived = await setGroups(s.apiA, eventId, roundId, [{ members: [aId, bId] }]);
    expect(derived.groups[0].members.map(m => [m.participant_id, m.position, m.side])).toEqual([[aId, 1, 1], [bId, 2, 2]]);
    const explicit = await setGroups(s.apiA, eventId, roundId, [{ name: 'Match 1', members: [{ participant_id: bId, side: 1 }, { participant_id: aId, side: 2 }] }]);
    expect(explicit.groups[0].members.map(m => [m.participant_id, m.position, m.side])).toEqual([[bId, 1, 1], [aId, 2, 2]]);
    const again = await readView(s.apiB, eventId);
    expect(again.groups[0].members.find(m => m.participant_id === bId)?.side).toBe(1);

    // Switching families keeps nothing silently: the stored `match` needs a fitting format_config.
    const stale = await s.apiA.patch(`/api/sport-events/${eventId}`, { data: { format: 'stroke_gross' } });
    expect(stale.status()).toBe(400);
    expect((await stale.json()).reason).toBe('format_config_stale');
    const switched = await s.apiA.patch(`/api/sport-events/${eventId}`, { data: { format: 'stroke_gross', format_config: {} } });
    expect(switched.status(), await readErrorBody(switched)).toBe(200);
    expect(((await switched.json()) as { event: { format: string; match: unknown } }).event).toMatchObject({ format: 'stroke_gross', match: null });
    const back = await s.apiA.patch(`/api/sport-events/${eventId}`, { data: { format: 'match_net', format_config: { match: { sides: 'fourball' } } } });
    expect(back.status(), await readErrorBody(back)).toBe(200);
    expect(((await back.json()) as { event: { match: { sides: string; allowance: number } } }).event.match).toEqual({ sides: 'fourball', bracket: false, allowance: 90 });

    // A stroke event refuses a side by name.
    const stroke = await createEvent(s.apiA, { name: `QA Stroke ${s.stamp}`, publish: true, round: { scheduled_on: '2030-06-01', course_name: 'QA Stroke Links' } });
    strokeId = stroke.event.id;
    const { participantId: bStroke, hostRowId: aStroke } = await inviteAndAccept(s, strokeId);
    const refused = await s.apiA.put(`/api/sport-events/${strokeId}/rounds/${stroke.rounds[0].id}/groups`, { data: { groups: [{ members: [{ participant_id: aStroke, side: 1 }, { participant_id: bStroke, side: 2 }] }] } });
    expect(refused.status()).toBe(400);
    expect((await refused.json()).error).toBe('Group 1: side is only set on a match-play event');
    const plain = await setGroups(s.apiA, strokeId, stroke.rounds[0].id, [{ members: [aStroke, bStroke] }]);
    expect(plain.groups[0].members.map(m => m.side ?? null)).toEqual([null, null]);

    // An org event on a match format never counts toward a competition.
    const { data: club } = await admin.from('clubs').insert({ name: `QA Match Club ${s.stamp}`, owner_profile_id: s.userA.id }).select('id').single();
    clubId = club!.id as string;
    await admin.from('memberships').insert([
      { club_id: clubId, profile_id: s.userA.id, role: 'owner', kind: 'follow' },
      { club_id: clubId, profile_id: s.userA.id, role: 'owner', kind: 'roster' },
    ]);
    const { data: season } = await admin.from('seasons').insert({ club_id: clubId, label: `2030 ${s.stamp}` }).select('id').single();
    const { data: league } = await admin.from('competitions').insert({ club_id: clubId, season_id: season!.id, sport_key: 'golf', name: `Match League ${s.stamp}`, format: 'leaderboard', entrant_type: 'athlete', scoring_rule: 'golf_net', status: 'active', visibility: 'public' }).select('id').single();
    const orgMatch = await s.apiA.post('/api/sport-events', { data: { name: `QA Match Org ${s.stamp}`, format: 'match_gross', club_id: clubId, competition_id: league!.id, round: { scheduled_on: '2030-06-01', course_name: 'QA Links' } } });
    expect(orgMatch.status()).toBe(400);
    expect((await orgMatch.json()).reason).toBe('not_stroke_play');
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await cleanupEvent(s.apiA, strokeId);
    if (clubId) await admin.from('clubs').delete().eq('id', clubId);
    await s.dispose();
  }
});

/**
 * PR 5 — the lifecycle of a match round. A hosts a nine-hole singles gross
 * match; the start refuses `groups_incomplete` with no draw and with a
 * one-side group (no bracket → no bye); with A vs B drawn the round starts:
 * the card reads `game_format 'match'`, one match row per group, the
 * completion refuses `matches_undecided` even with the override; A and B
 * score five holes (A 4s, B 5s → A wins 5&4) and the round completes
 * WITHOUT the override: the match row carries the outcome, every card is
 * final, the event completes with the results bell on the Matches tab.
 */
test('sport events API: match round lifecycle — groups_incomplete, the match rows, matches_undecided, the outcome written at completion', async () => {
  const s = await openEventSession();
  const admin = adminClient();
  const probe = await admin.from('sport_event_matches').select('id').limit(1);
  test.skip(!!probe.error, 'sport_event_matches missing — run migration 212');
  let eventId: string | null = null;
  try {
    const view = await createEvent(s.apiA, { name: `QA Match Round ${s.stamp}`, publish: true, format: 'match_gross', format_config: { match: { sides: 'singles' } }, round: { scheduled_on: '2030-06-01', course_name: 'QA Match Links', holes: 9, starting_hole: 1 } });
    eventId = view.event.id;
    const roundId = view.rounds[0].id;
    const { participantId: bId, hostRowId: aId } = await inviteAndAccept(s, eventId);

    // No draw, then a one-side group: the start refuses by name.
    const noDraw = await s.apiA.post(`/api/sport-events/${eventId}/rounds/${roundId}/transition`, { data: { to: 'live' } });
    expect(noDraw.status()).toBe(409);
    expect((await noDraw.json()).reason).toBe('groups_incomplete');
    await setGroups(s.apiA, eventId, roundId, [{ name: 'Final', members: [aId] }]);
    const oneSide = await s.apiA.post(`/api/sport-events/${eventId}/rounds/${roundId}/transition`, { data: { to: 'live' } });
    expect(oneSide.status()).toBe(409);
    const oneSideBody = (await oneSide.json()) as { reason: string; error: string };
    expect(oneSideBody.reason).toBe('groups_incomplete');
    expect(oneSideBody.error).toContain('Final');

    // A vs B: the round starts; the card is a match card; one match row, undecided.
    await setGroups(s.apiA, eventId, roundId, [{ members: [aId, bId] }]);
    const live = await startRound(s.apiA, eventId, roundId, '2030-06-01');
    expect(live.event.status).toBe('live');
    const groupPostId = live.rounds[0].group_post_id as string;
    const { data: cardRow } = await admin.from('golf_scorecard_data').select('game_format').eq('group_post_id', groupPostId).maybeSingle();
    expect(cardRow?.game_format).toBe('match');
    const { data: matchRows } = await admin.from('sport_event_matches').select('id, group_id, decided_by, winner_side, result, version').eq('sport_event_round_id', roundId);
    expect(matchRows).toHaveLength(1);
    expect(matchRows![0]).toMatchObject({ decided_by: null, winner_side: null, result: null, version: 0 });
    const again = await s.apiA.post(`/api/sport-events/${eventId}/rounds/${roundId}/transition`, { data: { to: 'live' } }); // a second start is refused, never a second mint
    expect(again.status()).toBe(409);
    const { count } = await admin.from('sport_event_matches').select('id', { count: 'exact', head: true }).eq('sport_event_round_id', roundId);
    expect(count).toBe(1);

    // Undecided: the completion refuses even with the override.
    const undecided = await s.apiA.post(`/api/sport-events/${eventId}/rounds/${roundId}/transition`, { data: { to: 'completed', override: true } });
    expect(undecided.status()).toBe(409);
    expect((await undecided.json()).reason).toBe('matches_undecided');

    // A 4s, B 5s over five holes → A wins 5&4; the round completes without the override.
    const card = await readScorecard(s.apiA, groupPostId);
    const aRow = cardRowFor(card, s.userA.id);
    const bRow = cardRowFor(card, s.userB.id);
    await scoreHoles(s.apiA, aRow, [1, 2, 3, 4, 5].map(h => ({ hole_number: h, strokes: 4 })));
    await scoreHoles(s.apiB, bRow, [1, 2, 3, 4, 5].map(h => ({ hole_number: h, strokes: 5 })));
    const done = await completeRound(s.apiA, eventId, roundId, false);
    expect(done.event.status).toBe('completed');
    expect(done.rounds[0].status).toBe('completed');
    const { data: decided } = await admin.from('sport_event_matches').select('decided_by, winner_side, result, decided_at, version').eq('sport_event_round_id', roundId).maybeSingle();
    expect(decided).toMatchObject({ decided_by: 'holes', winner_side: 1, result: '5&4', version: 1 });
    expect(decided?.decided_at).toBeTruthy();
    const after = await readScorecard(s.apiA, groupPostId);
    expect(after.participants.map(p => p.scores?.status)).toEqual(['final', 'final']);
    const { data: bell } = await admin.from('notifications').select('action_url').eq('user_id', s.userB.id).eq('type', 'sport_event_results').ilike('action_url', `%${eventId}%`).limit(1);
    expect(bell?.[0]?.action_url).toBe(`/events/${eventId}?tab=matches`);
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await s.dispose();
  }
});

/**
 * PR 6 — the match routes. GET matches (the stranger 404s; a stroke event
 * answers `not_match_play`; the leaderboard routes answer
 * `not_stroke_play`); B concedes hole 1, A concedes hole 2 (all square),
 * the wrong side is refused, a stale version conflicts, a second
 * concession of the same hole is refused; seven halved holes → all square
 * after nine → the extra-hole editor: n=1 halved, n=1 again refused, n=2
 * decides "11 holes"; the round completes without the override and the
 * row reads `extra_holes`. A second event: the organizer decides, B may
 * not, the decision clears, B concedes the match, the event completes
 * with ONE results bell for B.
 */
test('sport events API: the match routes — GET, concede, extra holes, decide, the CAS', async () => {
  const s = await openEventSession();
  const admin = adminClient();
  const probe = await admin.from('sport_event_matches').select('id').limit(1);
  test.skip(!!probe.error, 'sport_event_matches missing — run migration 212');
  let eventId: string | null = null;
  let secondId: string | null = null;
  try {
    const view = await createEvent(s.apiA, { name: `QA Match Routes ${s.stamp}`, publish: true, format: 'match_gross', format_config: { match: { sides: 'singles' } }, round: { scheduled_on: '2030-06-01', course_name: 'QA Match Links', holes: 9, starting_hole: 1 } });
    eventId = view.event.id;
    const roundId = view.rounds[0].id;
    const { participantId: bId, hostRowId: aId } = await inviteAndAccept(s, eventId);
    await setGroups(s.apiA, eventId, roundId, [{ members: [aId, bId] }]);
    const live = await startRound(s.apiA, eventId, roundId, '2030-06-01');
    const groupPostId = live.rounds[0].group_post_id as string;

    // GET: the stranger 404s, B reads one match, not started; the gross board is refused by name.
    expect((await s.anon.get(`/api/sport-events/${eventId}/matches`)).status()).toBe(404);
    const asB = await s.apiB.get(`/api/sport-events/${eventId}/matches`);
    expect(asB.status(), await readErrorBody(asB)).toBe(200);
    const list = (await asB.json()) as { event: { match: { sides: string; allowance: number } }; rounds: Array<{ id: string }>; matches: Array<{ id: string; version: number; title: string; line: string; state: { status: string; summary: string; up: number; thru: number; needsExtraHole: boolean; nextExtraHole: { n: number; hole_number: number } | null; result: string | null; decidedBy: string | null } }> };
    expect(list.event.match).toMatchObject({ sides: 'singles', allowance: 100 });
    expect(list.rounds.map(r => r.id)).toEqual([roundId]);
    expect(list.matches).toHaveLength(1);
    const m = list.matches[0];
    expect(m).toMatchObject({ version: 0, title: 'Match 1', state: { status: 'not_started', summary: 'Not started' } });
    expect(m.line).toContain(' vs ');
    const board = await s.apiA.get(`/api/sport-events/${eventId}/rounds/${roundId}/leaderboard`);
    expect(board.status()).toBe(409);
    expect((await board.json()).reason).toBe('not_stroke_play');
    expect((await s.apiA.get(`/api/sport-events/${eventId}/leaderboard`)).status()).toBe(409);

    // Concessions: B gives hole 1 (A 1 up); the wrong side is refused; a stale version conflicts; the same hole twice is refused; A gives hole 2 (all square).
    const wrongSide = await s.apiB.post(`/api/sport-events/${eventId}/matches/${m.id}/concede`, { data: { hole: 1, side: 1, version: 0 } });
    expect(wrongSide.status()).toBe(403);
    expect((await wrongSide.json()).reason).toBe('not_a_side');
    const c1 = await s.apiB.post(`/api/sport-events/${eventId}/matches/${m.id}/concede`, { data: { hole: 1, side: 2, version: 0 } });
    expect(c1.status(), await readErrorBody(c1)).toBe(200);
    const after1 = ((await c1.json()) as { match: typeof m }).match;
    expect(after1).toMatchObject({ version: 1, state: { up: 1, thru: 1, status: 'live' } });
    expect(after1.state.summary).toMatch(/1 UP thru 1$/);
    const stale = await s.apiB.post(`/api/sport-events/${eventId}/matches/${m.id}/concede`, { data: { hole: 3, side: 2, version: 0 } });
    expect(stale.status()).toBe(409);
    expect((await stale.json()).reason).toBe('conflict');
    const twice = await s.apiB.post(`/api/sport-events/${eventId}/matches/${m.id}/concede`, { data: { hole: 1, side: 2, version: 1 } });
    expect(twice.status()).toBe(400);
    expect((await twice.json()).reason).toBe('already_conceded');
    const c2 = await s.apiA.post(`/api/sport-events/${eventId}/matches/${m.id}/concede`, { data: { hole: 2, side: 1, version: 1 } });
    expect(c2.status(), await readErrorBody(c2)).toBe(200);
    expect(((await c2.json()) as { match: typeof m }).match.state).toMatchObject({ up: 0, thru: 2, summary: 'All square thru 2' });

    // Seven halved holes → all square after the last → the extra holes decide.
    const card = await readScorecard(s.apiA, groupPostId);
    const aRow = cardRowFor(card, s.userA.id);
    const bRow = cardRowFor(card, s.userB.id);
    const rest = [3, 4, 5, 6, 7, 8, 9].map(h => ({ hole_number: h, strokes: 4 }));
    await scoreHoles(s.apiA, aRow, rest);
    await scoreHoles(s.apiB, bRow, rest);
    const early = await s.apiA.post(`/api/sport-events/${eventId}/matches/${m.id}/extra-hole`, { data: { n: 2, strokes: { [aId]: 4, [bId]: 4 }, version: 2 } });
    expect(early.status()).toBe(400);
    expect((await early.json()).reason).toBe('wrong_extra_hole');
    const square = (await (await s.apiB.get(`/api/sport-events/${eventId}/matches?round=${roundId}`)).json()) as { matches: Array<typeof m> };
    expect(square.matches[0].state).toMatchObject({ status: 'live', needsExtraHole: true, nextExtraHole: { n: 1, hole_number: 1 }, thru: 9 });
    const e1 = await s.apiB.post(`/api/sport-events/${eventId}/matches/${m.id}/extra-hole`, { data: { n: 1, strokes: { [aId]: 4, [bId]: 4 }, version: 2 } });
    expect(e1.status(), await readErrorBody(e1)).toBe(200);
    expect(((await e1.json()) as { match: typeof m }).match.state).toMatchObject({ needsExtraHole: true, nextExtraHole: { n: 2, hole_number: 2 }, thru: 10 });
    const stranger = await s.apiA.post(`/api/sport-events/${eventId}/matches/${m.id}/extra-hole`, { data: { n: 2, strokes: { '00000000-0000-4000-8000-000000000000': 4 }, version: 3 } });
    expect(stranger.status()).toBe(400);
    expect((await stranger.json()).reason).toBe('unknown_participant');
    const e2 = await s.apiA.post(`/api/sport-events/${eventId}/matches/${m.id}/extra-hole`, { data: { n: 2, strokes: { [aId]: 3, [bId]: 4 }, version: 3 } });
    expect(e2.status(), await readErrorBody(e2)).toBe(200);
    const decided = ((await e2.json()) as { match: typeof m }).match;
    expect(decided.state).toMatchObject({ status: 'completed', decidedBy: 'extra_holes', result: '11 holes' });
    const late = await s.apiB.post(`/api/sport-events/${eventId}/matches/${m.id}/concede`, { data: { hole: 9, side: 2, version: 4 } });
    expect(late.status()).toBe(409);
    expect((await late.json()).reason).toBe('match_decided');
    const done = await completeRound(s.apiA, eventId, roundId, false);
    expect(done.event.status).toBe('completed');
    const { data: row } = await admin.from('sport_event_matches').select('decided_by, winner_side, result').eq('id', m.id).maybeSingle();
    expect(row).toEqual({ decided_by: 'extra_holes', winner_side: 1, result: '11 holes' });
    const closed = await s.apiB.post(`/api/sport-events/${eventId}/matches/${m.id}/concede`, { data: { hole: null, side: 2, version: 5 } });
    expect(closed.status()).toBe(409);
    expect((await closed.json()).reason).toBe('round_not_live');

    // The organizer's decision, its clearing, and a conceded match; ONE results bell.
    const second = await createEvent(s.apiA, { name: `QA Match Decide ${s.stamp}`, publish: true, format: 'match_net', format_config: { match: { sides: 'singles' } }, round: { scheduled_on: '2030-06-01', course_name: 'QA Match Links', holes: 9, starting_hole: 1 } });
    secondId = second.event.id;
    const r2 = second.rounds[0].id;
    const { participantId: b2, hostRowId: a2 } = await inviteAndAccept(s, secondId);
    await setGroups(s.apiA, secondId, r2, [{ members: [a2, b2] }]);
    await startRound(s.apiA, secondId, r2, '2030-06-01');
    const m2 = ((await (await s.apiA.get(`/api/sport-events/${secondId}/matches`)).json()) as { matches: Array<typeof m> }).matches[0];
    const notOrganizer = await s.apiB.post(`/api/sport-events/${secondId}/matches/${m2.id}/decide`, { data: { winner_side: 2, version: 0 } });
    expect(notOrganizer.status()).toBe(403);
    const d = await s.apiA.post(`/api/sport-events/${secondId}/matches/${m2.id}/decide`, { data: { winner_side: 2, version: 0 } });
    expect(d.status(), await readErrorBody(d)).toBe(200);
    expect(((await d.json()) as { match: typeof m }).match.state).toMatchObject({ status: 'completed', decidedBy: 'organizer', result: 'decided' });
    const cleared = await s.apiA.post(`/api/sport-events/${secondId}/matches/${m2.id}/decide`, { data: { winner_side: null, version: 1 } });
    expect(cleared.status(), await readErrorBody(cleared)).toBe(200);
    expect(((await cleared.json()) as { match: typeof m }).match.state.status).toBe('not_started');
    const conceded = await s.apiB.post(`/api/sport-events/${secondId}/matches/${m2.id}/concede`, { data: { hole: null, side: 2, version: 2 } });
    expect(conceded.status(), await readErrorBody(conceded)).toBe(200);
    expect(((await conceded.json()) as { match: typeof m }).match.state).toMatchObject({ status: 'completed', decidedBy: 'concession', result: 'conceded' });
    const notYours = await s.apiA.post(`/api/sport-events/${secondId}/matches/${m2.id}/decide`, { data: { winner_side: null, version: 3 } });
    expect(notYours.status()).toBe(409);
    expect((await notYours.json()).reason).toBe('not_organizer_decision');
    const finished = await completeRound(s.apiA, secondId, r2, false);
    expect(finished.event.status).toBe('completed');
    const { data: bells } = await admin.from('notifications').select('id').eq('user_id', s.userB.id).eq('type', 'sport_event_results').ilike('action_url', `%${secondId}%`);
    expect(bells).toHaveLength(1);
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await cleanupEvent(s.apiA, secondId);
    await s.dispose();
  }
});
