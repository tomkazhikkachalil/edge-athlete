import { test, expect } from '@playwright/test';
import { adminClient, readErrorBody } from './helpers/qa-user';
import { cleanupEvent, createEvent, inviteAndAccept, openEventSession, readView, setGroups } from './helpers/sport-events';

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
