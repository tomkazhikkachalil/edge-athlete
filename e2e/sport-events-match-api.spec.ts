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
