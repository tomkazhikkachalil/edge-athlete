import { test, expect } from '@playwright/test';
import { adminClient, readErrorBody } from './helpers/qa-user';
import { cardRowFor, cleanupEvent, completeRound, goLive, openEventSession, readScorecard, readView, scoreHoles } from './helpers/sport-events';

type Detail = { contests: Array<{ id: string; status: string; stage: number | null; slot: number | null; participants: Array<{ id: string; entry_id: string; side: string | null; result: { score: number | null; provenance: string; payload?: Record<string, unknown> | null } | null }> }>; standings: Array<{ entry_id: string; rank: number }> };
type WithLink = { counts_toward?: { competition_id: string; contests: Array<{ round_id: string; contest_id: string }> } | null };

/**
 * Competition formats (track 2), PR 11 — the match bridge through the API.
 * NEEDS MIGRATION 220 ON THE TARGET (self-skips before). A owns a golf
 * league with B and C rostered and a two-player bracket: the final runs
 * as a singles match-play round (the sides, the group, the round link);
 * go-live stamps the minted match into the contest and clears the round
 * link; a hand result is refused; B wins 10&8 on the cards; completion
 * writes 1–0 with the league's provenance and the result in the payload,
 * the standings crown B, and the event still counts toward the bracket.
 */
test('the match bridge: a bracket final runs as a match, go-live swaps the link, completion writes the winner and crowns the champion', async () => {
  test.setTimeout(180_000);
  const s = await openEventSession();
  const admin = adminClient();
  const probe = await admin.from('contests').select('sport_event_match_id').limit(1);
  test.skip(!!probe.error, 'contests.sport_event_match_id missing — run migration 220');
  test.skip(!s.apiC || !s.userC, 'the four QA users are not minted — an older global setup');
  const apiC = s.apiC!;
  const userC = s.userC!;
  const stamp = s.stamp;
  const { data: league, error } = await admin.from('leagues').insert({ name: `QA Match Bridge ${stamp}`, sport_key: 'golf', owner_profile_id: s.userA.id, visibility: 'public' }).select().single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  let eventId: string | null = null;
  try {
    await admin.from('memberships').insert([
      { league_id: leagueId, profile_id: s.userA.id, kind: 'follow', role: 'owner', status: 'active', scope_type: 'org', scope_id: null },
      ...[s.userB.id, userC.id].map(profile_id => ({ league_id: leagueId, profile_id, kind: 'roster', role: 'member', status: 'active', scope_type: 'org', scope_id: null })),
    ]);
    const { data: season } = await admin.from('seasons').insert({ league_id: leagueId, label: '2026' }).select().single();
    const base = `/api/leagues/${leagueId}/competitions`;
    const created = await s.apiA.post(base, { data: { side: 'league', orgId: leagueId, seasonId: season!.id, sportKey: 'golf', name: 'Club Match Play', format: 'bracket', visibility: 'public' } });
    expect(created.ok(), await readErrorBody(created)).toBe(true);
    const compBody = (await created.json()) as { competition?: { id: string; entrant_type: string }; id?: string; entrant_type?: string };
    const compId = compBody.competition?.id ?? compBody.id!;
    expect(compBody.competition?.entrant_type ?? compBody.entrant_type).toBe('athlete');
    await admin.from('competitions').update({ status: 'active' }).eq('id', compId);
    const enter = async (profileId: string) => {
      const res = await s.apiA.post(`${base}/entries`, { data: { competitionId: compId, profileId } });
      expect(res.ok(), await readErrorBody(res)).toBe(true);
      const b = (await res.json()) as { entry?: { id: string }; id?: string };
      return b.entry?.id ?? b.id!;
    };
    const eB = await enter(s.userB.id);
    const eC = await enter(userC.id);
    expect((await s.apiA.put(`${base}/${compId}/seeds`, { data: { competitionId: compId, entryIds: [eB, eC] } })).ok()).toBe(true);
    const gen = await s.apiA.post(`${base}/${compId}/bracket`, { data: { competitionId: compId, dryRun: false } });
    expect(gen.status(), await readErrorBody(gen)).toBe(201);
    const detail = async () => (await (await s.apiA.get(`${base}/${compId}`)).json()) as Detail;
    let d = await detail();
    const final = d.contests.find(c => c.stage === 1 && c.slot === 1)!;
    expect(final.participants.map(p => [p.side, p.entry_id]).sort()).toEqual([['away', eC], ['home', eB]]);

    // The door: the final runs as a singles match; the round link first.
    const door = await s.apiA.post(`${base}/${compId}/contests/${final.id}/event`, { data: { competitionId: compId, contestId: final.id, scheduledOn: '2030-06-01', place: 'QA Links', format: 'match_gross' } });
    expect(door.status(), await readErrorBody(door)).toBe(201);
    const opened = (await door.json()) as { event_id: string; round_id: string; kind: string; match_sides?: string; players: number };
    eventId = opened.event_id;
    expect(opened).toMatchObject({ kind: 'match', match_sides: 'singles', players: 2 });
    let v = await readView(s.apiA, opened.event_id);
    expect(v.event).toMatchObject({ status: 'open', format: 'match_gross', match: { sides: 'singles', bracket: false } });
    expect(v.participants.filter(p => p.playing).map(p => p.profile_id).sort()).toEqual([s.userB.id, userC.id].sort());
    const idOf = (profileId: string) => v.participants.find(p => p.profile_id === profileId)!.id;
    const group = v.groups.find(g => g.sport_event_round_id === opened.round_id)!;
    expect(group.members.find(m => m.participant_id === idOf(s.userB.id))?.side).toBe(1);
    expect(group.members.find(m => m.participant_id === idOf(userC.id))?.side).toBe(2);
    const linkBefore = await admin.from('contests').select('sport_event_round_id, sport_event_match_id').eq('id', final.id).single();
    expect(linkBefore.data).toEqual({ sport_event_round_id: opened.round_id, sport_event_match_id: null });

    // Go-live: the minted match takes the link, the round link clears, the contest is in progress; a hand result is refused.
    v = await goLive(s.apiA, opened.event_id, '2030-06-01');
    expect(v.rounds[0].status).toBe('live');
    const { data: matchRow } = await admin.from('sport_event_matches').select('id').eq('sport_event_round_id', opened.round_id).single();
    const linkAfter = await admin.from('contests').select('sport_event_round_id, sport_event_match_id, status').eq('id', final.id).single();
    expect(linkAfter.data).toEqual({ sport_event_round_id: null, sport_event_match_id: matchRow!.id, status: 'in_progress' });
    const byHand = await s.apiA.post(`${base}/results`, { data: { contestId: final.id, results: [{ participantId: final.participants[0].id, score: 1 }] } });
    expect(byHand.status()).toBe(409);
    expect(((await byHand.json()) as { reason?: string }).reason).toBe('from_event');
    v = await readView(s.apiA, opened.event_id);
    expect((v as unknown as WithLink).counts_toward).toMatchObject({ competition_id: compId, contests: [{ round_id: opened.round_id, contest_id: final.id }] });

    // The cards: B 4s, C 5s over ten holes — 10 up with eight to play.
    const card = await readScorecard(s.apiA, v.rounds[0].group_post_id as string);
    const holes = (strokes: number) => Array.from({ length: 10 }, (_, i) => ({ hole_number: i + 1, strokes }));
    await scoreHoles(s.apiB, cardRowFor(card, s.userB.id), holes(4));
    await scoreHoles(apiC, cardRowFor(card, userC.id), holes(5));
    v = await completeRound(s.apiA, opened.event_id, opened.round_id);
    expect(v.rounds[0].status).toBe('completed');
    expect(v.event.status).toBe('completed');

    // The bracket's result: B 1, C 0, league-verified, the match's result in the payload; B the champion.
    d = await detail();
    const done = d.contests.find(c => c.id === final.id)!;
    expect(done.status).toBe('completed');
    const home = done.participants.find(p => p.side === 'home')!;
    const away = done.participants.find(p => p.side === 'away')!;
    expect(home.result).toMatchObject({ score: 1, provenance: 'league_verified', payload: { match: { result: '10&8', won: true }, sportEvent: { eventId: opened.event_id, roundId: opened.round_id, matchId: matchRow!.id } } });
    expect(away.result).toMatchObject({ score: 0, provenance: 'league_verified', payload: { match: { won: false } } });
    expect(d.standings.find(r => r.entry_id === eB)?.rank).toBe(1);
    expect(d.standings.find(r => r.entry_id === eC)?.rank).toBe(2);
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await admin.from('leagues').delete().eq('id', leagueId);
    await s.dispose();
  }
});
