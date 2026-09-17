import { test, expect } from '@playwright/test';
import { adminClient, readErrorBody } from './helpers/qa-user';
import { cleanupEvent, goLive, openEventSession, readView, roundTransition } from './helpers/sport-events';

type Detail = { contests: Array<{ id: string; status: string; participants: Array<{ id: string; entry_id: string; side: string | null; result: { score: number | null; provenance: string } | null }> }>; standings: Array<{ entry_id: string; rank: number; points: number | null; entrant_name: string }> };
type WithLink = { counts_toward?: { competition_id: string; competition_name: string; contests: Array<{ round_id: string; contest_id: string }> } | null };

/**
 * Competition formats (track 2), PR 10 — the game bridge through the API,
 * FOUR QA users. NEEDS MIGRATION 219 ON THE TARGET (self-skips before). A
 * owns a hockey league with B, C and D on the roster and a fixture of
 * named sides: Reds {B} vs Blues {C, D}, one scheduled game. Door 2: the
 * game RUNS AS an event — the sides and the players pre-filled, the link
 * stamped, a second door refused; the hand writers are refused while
 * linked; live, B enters a line and A keeps the score; completion writes
 * 3–1 with the league's provenance, B's stat line, the standings. Door 1:
 * a game event hosted for the league that counts toward the competition
 * reuses Reds by name and mints Greens with its source_ref.
 */
test('the game bridge: a contest runs as an event, completion writes the fixture; an event mints the fixture with its sides', async () => {
  test.setTimeout(180_000);
  const s = await openEventSession();
  const admin = adminClient();
  const probe = await admin.from('competition_entries').select('source_ref').limit(1);
  test.skip(!!probe.error, 'competition_entries.source_ref missing — run migration 219');
  test.skip(!s.apiC || !s.userC || !s.apiD || !s.userD, 'the four QA users are not minted — an older global setup');
  const userC = s.userC!;
  const userD = s.userD!;
  const stamp = s.stamp;
  const { data: league, error } = await admin.from('leagues').insert({ name: `QA Bridge League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: s.userA.id, visibility: 'public' }).select().single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  let eventId1: string | null = null;
  let eventId2: string | null = null;
  try {
    await admin.from('memberships').insert([
      { league_id: leagueId, profile_id: s.userA.id, kind: 'follow', role: 'owner', status: 'active', scope_type: 'org', scope_id: null },
      ...[s.userB.id, userC.id, userD.id].map(profile_id => ({ league_id: leagueId, profile_id, kind: 'roster', role: 'member', status: 'active', scope_type: 'org', scope_id: null })),
    ]);
    const { data: season } = await admin.from('seasons').insert({ league_id: leagueId, label: '2026-27' }).select().single();
    const base = `/api/leagues/${leagueId}/competitions`;
    const created = await s.apiA.post(base, { data: { side: 'league', orgId: leagueId, seasonId: season!.id, sportKey: 'ice_hockey', name: 'Pickup League', format: 'fixture', entrantType: 'ad_hoc_team', visibility: 'public' } });
    expect(created.ok(), await readErrorBody(created)).toBe(true);
    const compBody = (await created.json()) as { competition?: { id: string }; id?: string };
    const compId = compBody.competition?.id ?? compBody.id!;
    await admin.from('competitions').update({ status: 'active' }).eq('id', compId);
    const addSide = async (name: string, members: string[]) => {
      const res = await s.apiA.post(`${base}/entries`, { data: { competitionId: compId, name, memberProfileIds: members } });
      expect(res.ok(), await readErrorBody(res)).toBe(true);
      const b = (await res.json()) as { entry?: { id: string }; id?: string };
      return b.entry?.id ?? b.id!;
    };
    const reds = await addSide('Reds', [s.userB.id]);
    const blues = await addSide('Blues', [userC.id, userD.id]);
    const contestRes = await s.apiA.post(`${base}/${compId}/contests`, { data: { competitionId: compId, homeEntryId: reds, awayEntryId: blues, scheduledAt: '2030-06-01T19:30:00.000Z', round: 'Week 1' } });
    expect(contestRes.ok(), await readErrorBody(contestRes)).toBe(true);
    const contestId = ((await contestRes.json()) as { contest: { id: string } }).contest.id;
    const detail = async () => (await (await s.apiA.get(`${base}/${compId}`)).json()) as Detail;

    // Door 2: the game runs as an event — the sides, the players, the group's sent sides, the link; a second door refused.
    const doorUrl = `${base}/${compId}/contests/${contestId}/event`;
    const door = await s.apiA.post(doorUrl, { data: { competitionId: compId, contestId, scheduledOn: '2030-06-01', startsAt: '2030-06-01T19:30:00.000Z', place: 'QA Rink' } });
    expect(door.status(), await readErrorBody(door)).toBe(201);
    const opened = (await door.json()) as { event_id: string; round_id: string; sides: [string, string]; players: number };
    eventId1 = opened.event_id;
    expect(opened.sides).toEqual(['Reds', 'Blues']);
    expect(opened.players).toBe(3);
    const again = await s.apiA.post(doorUrl, { data: { competitionId: compId, contestId, scheduledOn: '2030-06-01' } });
    expect(again.status()).toBe(409);
    expect(((await again.json()) as { reason?: string }).reason).toBe('already_linked');
    let v = await readView(s.apiA, opened.event_id);
    expect(v.event).toMatchObject({ status: 'open', shape: 'game', game: { side_names: ['Reds', 'Blues'] } });
    expect(v.rounds[0]).toMatchObject({ id: opened.round_id, course_name: 'QA Rink', scheduled_on: '2030-06-01' });
    expect(v.participants.filter(p => p.playing && p.status === 'accepted').map(p => p.profile_id).sort()).toEqual([s.userB.id, userC.id, userD.id].sort());
    expect(v.participants.find(p => p.profile_id === s.userA.id)).toMatchObject({ role: 'organizer', playing: false });
    const idOf = (profileId: string) => v.participants.find(p => p.profile_id === profileId)!.id;
    const group = v.groups.find(g => g.sport_event_round_id === opened.round_id)!;
    expect(group.members.find(m => m.participant_id === idOf(s.userB.id))?.side).toBe(1);
    expect(group.members.find(m => m.participant_id === idOf(userC.id))?.side).toBe(2);
    expect(group.members.find(m => m.participant_id === idOf(userD.id))?.side).toBe(2);
    expect((v as unknown as WithLink).counts_toward).toMatchObject({ competition_id: compId, contests: [{ round_id: opened.round_id, contest_id: contestId }] });

    // The hand writers are refused while linked.
    let d = await detail();
    const homePart = d.contests.find(c => c.id === contestId)!.participants.find(p => p.side === 'home')!;
    const byHand = await s.apiA.post(`${base}/${compId}/results`, { data: { contestId, results: [{ participantId: homePart.id, score: 1 }] } });
    expect(byHand.status()).toBe(409);
    expect(((await byHand.json()) as { reason?: string }).reason).toBe('from_event');
    const linesByHand = await s.apiA.post(`${base}/${compId}/stat-lines`, { data: { contestId, lines: [{ profileId: s.userB.id, stats: { goals: 9 } }] } });
    expect(linesByHand.status()).toBe(409);
    expect(((await linesByHand.json()) as { reason?: string }).reason).toBe('from_event');

    // Live: B enters a line, A keeps the score; completion writes the fixture.
    v = await goLive(s.apiA, opened.event_id, '2030-06-01');
    expect(v.rounds[0].status).toBe('live');
    const statsUrl = `/api/sport-events/${opened.event_id}/rounds/${opened.round_id}/stats`;
    const stats = (await (await s.apiA.get(statsUrl)).json()) as { lines: Array<{ id: string; profile_id: string }> };
    const bLine = stats.lines.find(l => l.profile_id === s.userB.id)!.id;
    const w = await s.apiB.put(`${statsUrl}/${bLine}`, { data: { stats: { goals: 2, assists: 1 }, expected_version: 0 } });
    expect(w.status(), await readErrorBody(w)).toBe(200);
    const sc = await s.apiA.put(`/api/sport-events/${opened.event_id}/rounds/${opened.round_id}/score`, { data: { side1_score: 3, side2_score: 1, period: 3, expected_version: 0 } });
    expect(sc.status(), await readErrorBody(sc)).toBe(200);
    d = await detail();
    expect(d.contests.find(c => c.id === contestId)!.status).toBe('in_progress');
    v = await roundTransition(s.apiA, opened.event_id, opened.round_id, 'completed');
    expect(v.event.status).toBe('completed');
    d = await detail();
    const done = d.contests.find(c => c.id === contestId)!;
    expect(done.status).toBe('completed');
    expect(done.participants.find(p => p.side === 'home')!.result).toMatchObject({ score: 3, provenance: 'league_verified' });
    expect(done.participants.find(p => p.side === 'away')!.result).toMatchObject({ score: 1, provenance: 'league_verified' });
    expect(d.standings.map(r => [r.entrant_name, r.rank, r.points])).toEqual([['Reds', 1, 2], ['Blues', 2, 0]]);
    const { data: lines } = await admin.from('contest_stat_lines').select('profile_id, team_id, stats, provenance').eq('contest_id', contestId);
    expect(lines).toEqual([{ profile_id: s.userB.id, team_id: null, stats: { goals: 2, assists: 1 }, provenance: 'league_verified' }]);
    const { data: redMembers } = await admin.from('competition_entry_members').select('profile_id').eq('entry_id', reds);
    expect((redMembers ?? []).map(m => m.profile_id)).toEqual([s.userB.id]);

    // Door 1: a game event hosted for the league counting toward the competition — Reds reused by name, Greens minted with its source_ref.
    const ev2 = await s.apiA.post('/api/sport-events', { data: { name: `QA Bridge Game 2 ${stamp}`, sport_key: 'ice_hockey', shape: 'game', visibility: 'public', join_mode: 'open', publish: true, host_plays: false, league_id: leagueId, competition_id: compId, format_config: { game: { side_names: ['Reds', 'Greens'] } }, round: { scheduled_on: '2030-06-02', course_name: 'QA Rink' } } });
    expect(ev2.status(), await readErrorBody(ev2)).toBe(201);
    const view2 = (await ev2.json()) as { event: { id: string } } & WithLink;
    eventId2 = view2.event.id;
    expect(view2.counts_toward?.competition_id).toBe(compId);
    expect(view2.counts_toward?.contests).toHaveLength(1);
    const { data: entries } = await admin.from('competition_entries').select('id, name, source_ref').eq('competition_id', compId).is('team_id', null).is('profile_id', null).order('name');
    expect((entries ?? []).map(e => e.name)).toEqual(['Blues', 'Greens', 'Reds']);
    expect((entries ?? []).find(e => e.name === 'Reds')!.id).toBe(reds);
    expect((entries ?? []).find(e => e.name === 'Greens')!.source_ref).toBe(`sport_event_side:${eventId2}:2`);
    d = await detail();
    const second = d.contests.find(c => c.id === view2.counts_toward!.contests[0].contest_id)!;
    expect(second.participants.map(p => [p.side, p.entry_id]).sort()).toEqual([['away', (entries ?? []).find(e => e.name === 'Greens')!.id], ['home', reds]].sort());
    // A golf leaderboard is not a game's home.
    const wrong = await s.apiA.post('/api/sport-events', { data: { name: `QA Bridge Wrong ${stamp}`, sport_key: 'ice_hockey', shape: 'game', league_id: leagueId, competition_id: '00000000-0000-4000-8000-000000000009', round: { scheduled_on: '2030-06-03', course_name: 'QA Rink' } } });
    expect(wrong.status()).toBe(400);
    expect(((await wrong.json()) as { reason?: string }).reason).toBe('not_found');
  } finally {
    await cleanupEvent(s.apiA, eventId1);
    await cleanupEvent(s.apiA, eventId2);
    await admin.from('leagues').delete().eq('id', leagueId);
    await s.dispose();
  }
});
