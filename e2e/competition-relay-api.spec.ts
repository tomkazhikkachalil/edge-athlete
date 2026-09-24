import { test, expect } from '@playwright/test';
import { createQaOrg } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

type Detail = { standings: Array<{ entry_id: string; rank: number; points: number | null; entrant_name: string }> };

/**
 * Events + formats leftovers, PR 3 — relays in a meet through the API.
 * NEEDS MIGRATION 219 ON THE TARGET (self-skips before). The owner (B)
 * runs a track-and-field league with A and C on Red and D on Blue. A relay
 * team is an ad-hoc entry of legs: "Red A" {A, C} takes Red as its
 * affiliation, "Mixed" {A, D} is unattached until the PATCH puts it on
 * Blue. The 4×100 refuses an athlete entry, the 100m refuses a relay team;
 * a relay writes no stat line; the team standings roll the relay's points
 * up; the public block names the relay team.
 */
test('relays: relay teams as entries, marks by kind, no personal record, the roll-up and the public winner', async () => {
  test.setTimeout(150_000);
  const owner = loadQaUser('user-b.json');
  const athleteA = loadQaUser('user.json');
  const athleteC = loadQaUser('user-c.json');
  const athleteD = loadQaUser('user-d.json');
  const admin = adminClient();
  const probe = await admin.from('competition_entries').select('affiliation_team_id').limit(1);
  test.skip(!!probe.error, 'competition_entries.affiliation_team_id missing — run migration 219');
  const api = await apiAs('state-b.json');
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA Relay League ${stamp}`, sport_key: 'track_field', owner_profile_id: owner.id, visibility: 'public' });
  const leagueId = league.id;
  try {
    const { data: teams } = await admin.from('teams').insert([{ org_id: leagueId, name: `Red ${stamp}` }, { org_id: leagueId, name: `Blue ${stamp}` }]).select('id, name');
    const red = teams!.find(t => (t.name as string).startsWith('Red'))!.id as string;
    const blue = teams!.find(t => (t.name as string).startsWith('Blue'))!.id as string;
    const roster = (profileId: string) => ({ org_id: leagueId, profile_id: profileId, kind: 'roster', role: 'member', status: 'active', scope_type: 'org', scope_id: null });
    const onTeam = (profileId: string, teamId: string) => ({ org_id: leagueId, profile_id: profileId, kind: 'roster', role: 'member', status: 'active', scope_type: 'team', scope_id: teamId });
    const { error: memberError } = await admin.from('memberships').insert([
      { org_id: leagueId, profile_id: owner.id, kind: 'follow', role: 'owner', status: 'active', scope_type: 'org', scope_id: null },
      roster(athleteA.id), roster(athleteC.id), roster(athleteD.id),
      onTeam(athleteA.id, red), onTeam(athleteC.id, red), onTeam(athleteD.id, blue),
    ]);
    expect(memberError, memberError?.message).toBeNull();
    const { data: season } = await admin.from('seasons').insert({ org_id: leagueId, label: '2026' }).select().single();
    const base = `/api/leagues/${leagueId}/competitions`;
    const created = await api.post(base, { data: { side: 'league', orgId: leagueId, seasonId: season!.id, sportKey: 'track_field', name: 'Relay Meet', format: 'meet', visibility: 'public' } });
    expect(created.ok(), await readErrorBody(created)).toBe(true);
    const compBody = (await created.json()) as { competition?: { id: string }; id?: string };
    const compId = compBody.competition?.id ?? compBody.id!;
    await admin.from('competitions').update({ status: 'active' }).eq('id', compId);
    const enter = async (data: Record<string, unknown>) => {
      const res = await api.post(`${base}/entries`, { data: { competitionId: compId, ...data } });
      expect(res.ok(), await readErrorBody(res)).toBe(true);
      const b = (await res.json()) as { entry?: { id: string; affiliation_team_id?: string | null; name?: string | null } };
      return b.entry!;
    };

    // Relay teams: the common team is the affiliation; a mixed relay is unattached until the PATCH.
    const redA = await enter({ name: 'Red A', memberProfileIds: [athleteA.id, athleteC.id] });
    expect(redA).toMatchObject({ name: 'Red A', affiliation_team_id: red });
    const mixed = await enter({ name: 'Mixed', memberProfileIds: [athleteA.id, athleteD.id] });
    expect(mixed.affiliation_team_id ?? null).toBeNull();
    const onBlue = await api.patch(`${base}/entries`, { data: { entryId: mixed.id, affiliationTeamId: blue } });
    expect(onBlue.ok(), await readErrorBody(onBlue)).toBe(true);
    const dEntry = await enter({ profileId: athleteD.id });

    // The events: a relay and an individual event.
    const gen = await api.post(`${base}/${compId}/meet/events`, { data: { competitionId: compId, eventKeys: ['relay_4x100', 'time_100m'] } });
    expect(gen.status(), await readErrorBody(gen)).toBe(201);
    const { created: events } = (await gen.json()) as { created: Array<{ id: string; round: string }> };
    const relay = events.find(e => e.round === '4×100m relay')!;
    const sprint = events.find(e => e.round === '100m')!;

    // Marks by kind.
    const athleteOnRelay = await api.post(`${base}/${compId}/meet/results`, { data: { contestId: relay.id, marks: [{ entryId: dEntry.id, mark: '42.00' }] } });
    expect(athleteOnRelay.status()).toBe(400);
    expect(((await athleteOnRelay.json()) as { reason?: string }).reason).toBe('entry_kind');
    const relayMarks = await api.post(`${base}/${compId}/meet/results`, { data: { contestId: relay.id, marks: [{ entryId: redA.id, mark: '42.10' }, { entryId: mixed.id, mark: '43.00' }] } });
    expect(relayMarks.ok(), await readErrorBody(relayMarks)).toBe(true);
    const relayOnSprint = await api.post(`${base}/${compId}/meet/results`, { data: { contestId: sprint.id, marks: [{ entryId: redA.id, mark: '11.00' }] } });
    expect(((await relayOnSprint.json()) as { reason?: string }).reason).toBe('entry_kind');
    const sprintMarks = await api.post(`${base}/${compId}/meet/results`, { data: { contestId: sprint.id, marks: [{ entryId: dEntry.id, mark: '11.50' }] } });
    expect(sprintMarks.ok(), await readErrorBody(sprintMarks)).toBe(true);

    // No personal record for a relay; the athlete's line for the sprint.
    expect((await admin.from('contest_stat_lines').select('id').eq('contest_id', relay.id)).data).toHaveLength(0);
    expect((await admin.from('contest_stat_lines').select('id').eq('contest_id', sprint.id)).data).toHaveLength(1);

    // The roll-up: Red 10 (the relay), Blue 8 (Mixed) + 10 (D's sprint) = 18.
    const d = (await (await api.get(`${base}/${compId}`)).json()) as Detail;
    expect(d.standings.map(r => [r.entrant_name.split(' ')[0], r.rank, r.points])).toEqual([['Blue', 1, 18], ['Red', 2, 10]]);

    // The public block names the relay team.
    const pub = (await (await api.get(`/api/leagues/${leagueId}/standings?_cb=${Date.now()}`)).json()) as { competitions: Array<{ id: string; meet?: { events: Array<{ round: string; winner: { name: string; mark: string } | null }> } }> };
    const block = pub.competitions.find(c => c.id === compId)?.meet;
    expect(block?.events.find(e => e.round === '4×100m relay')?.winner).toEqual({ name: 'Red A', mark: '42.10s' });
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
    await api.dispose();
  }
});
