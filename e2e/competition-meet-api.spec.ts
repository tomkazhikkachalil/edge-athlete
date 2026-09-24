import { test, expect } from '@playwright/test';
import { createQaOrg } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

/**
 * Competition formats (track 2), PR 7 — a meet through the API. NEEDS
 * MIGRATIONS 218 + 219 ON THE TARGET (self-skips before 219). The owner
 * (B) mints a track-and-field league with two teams (Red, Blue) and three
 * rostered athletes — A on Red, C on Blue, D on no team — then a meet
 * (a bracket is refused for the sport). The affiliations are snapshotted
 * at entry (D's is null until a PATCH puts D on Blue). Two events are
 * minted (an unknown key refused, a repeat skipped). The 100m marks: a bad
 * mark refused, an outsider refused, A 11.85 · C 12.10 · D DQ; the 200m:
 * C 23.50 · A 24.00 · D 24.80. The contest place ranks the 100m by the
 * event's rule (D unranked); the team standings read Blue 24 · Red 18 with
 * the medals; one stat line per athlete per event and its performance row.
 */
type Detail = { contests: Array<{ id: string; stage: number | null; slot: number | null; round: string | null; status: string }>; standings: Array<{ entry_id: string; rank: number; points: number | null; stats: Record<string, number>; entrant_name: string }>; standingsColumns: Array<{ key: string }> };

test('meet API: affiliations, events minted, marks with a DQ, the event outcome, the team standings, the stat lines', async () => {
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
  const league = await createQaOrg(admin, 'league', { name: `QA Meet League ${stamp}`, sport_key: 'track_field', owner_profile_id: owner.id, visibility: 'public' });
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
      onTeam(athleteA.id, red), onTeam(athleteC.id, blue),
    ]);
    expect(memberError, memberError?.message).toBeNull();
    const { data: season } = await admin.from('seasons').insert({ org_id: leagueId, label: '2026' }).select().single();
    const seasonId = season!.id as string;
    const base = `/api/leagues/${leagueId}/competitions`;

    // The sport's profile offers only the meet: a bracket is refused by name; the meet takes athletes.
    const bracket = await api.post(base, { data: { side: 'league', orgId: leagueId, seasonId, sportKey: 'track_field', name: 'Playoffs', format: 'bracket', visibility: 'public' } });
    expect(bracket.status()).toBe(400);
    const created = await api.post(base, { data: { side: 'league', orgId: leagueId, seasonId, sportKey: 'track_field', name: 'Spring Meet', format: 'meet', visibility: 'public' } });
    expect(created.ok(), await readErrorBody(created)).toBe(true);
    const compBody = (await created.json()) as { competition?: { id: string; entrant_type: string }; id?: string; entrant_type?: string };
    const compId = compBody.competition?.id ?? compBody.id!;
    expect(compBody.competition?.entrant_type ?? compBody.entrant_type).toBe('athlete');
    await admin.from('competitions').update({ status: 'active' }).eq('id', compId);

    // Entries snapshot the athlete's team-scope roster row; D has none until the PATCH.
    const entryOf = new Map<string, string>();
    for (const p of [athleteA, athleteC, athleteD]) {
      const res = await api.post(`${base}/entries`, { data: { competitionId: compId, profileId: p.id } });
      expect(res.ok(), await readErrorBody(res)).toBe(true);
      const b = (await res.json()) as { entry?: { id: string }; id?: string };
      entryOf.set(p.id, b.entry?.id ?? b.id!);
    }
    const { data: entryRows } = await admin.from('competition_entries').select('id, profile_id, affiliation_team_id').eq('competition_id', compId);
    const affiliation = new Map((entryRows ?? []).map(r => [r.profile_id as string, r.affiliation_team_id as string | null]));
    expect(affiliation.get(athleteA.id)).toBe(red);
    expect(affiliation.get(athleteC.id)).toBe(blue);
    expect(affiliation.get(athleteD.id)).toBeNull();
    const foreign = await api.patch(`${base}/entries`, { data: { entryId: entryOf.get(athleteD.id), affiliationTeamId: '00000000-0000-4000-8000-000000000009' } });
    expect(foreign.status()).toBe(404);
    const onBlue = await api.patch(`${base}/entries`, { data: { entryId: entryOf.get(athleteD.id), affiliationTeamId: blue } });
    expect(onBlue.ok(), await readErrorBody(onBlue)).toBe(true);

    // The events: an unknown key refused; two minted in session 1 (round = the label, slot = the order); a repeat skips.
    const unknown = await api.post(`${base}/${compId}/meet/events`, { data: { competitionId: compId, eventKeys: ['time_5000m'] } });
    expect(unknown.status()).toBe(400);
    expect(((await unknown.json()) as { reason?: string }).reason).toBe('unknown_event');
    const gen = await api.post(`${base}/${compId}/meet/events`, { data: { competitionId: compId, eventKeys: ['time_100m', 'time_200m'] } });
    expect(gen.status(), await readErrorBody(gen)).toBe(201);
    const genBody = (await gen.json()) as { created: Array<{ id: string; round: string; stage: number; slot: number }>; skipped: string[] };
    expect(genBody.created.map(c => [c.round, c.stage, c.slot])).toEqual([['100m', 1, 1], ['200m', 1, 2]]);
    const again = await api.post(`${base}/${compId}/meet/events`, { data: { competitionId: compId, eventKeys: ['time_100m', 'time_200m'] } });
    expect(again.status()).toBe(200);
    expect((await again.json()) as { created: unknown[]; skipped: string[] }).toMatchObject({ created: [], skipped: ['100m', '200m'] });
    const [c100, c200] = genBody.created;
    const eA = entryOf.get(athleteA.id)!;
    const eC = entryOf.get(athleteC.id)!;
    const eD = entryOf.get(athleteD.id)!;

    // The marks: a bad mark and an outsider refused by name; a DQ carries no mark.
    const bad = await api.post(`${base}/${compId}/meet/results`, { data: { contestId: c100.id, marks: [{ entryId: eA, mark: 'fast' }] } });
    expect(bad.status()).toBe(400);
    expect(((await bad.json()) as { reason?: string }).reason).toBe('bad_mark');
    const outsider = await api.post(`${base}/${compId}/meet/results`, { data: { contestId: c100.id, marks: [{ entryId: '00000000-0000-4000-8000-000000000009', mark: '11.00' }] } });
    expect(outsider.status()).toBe(400);
    expect(((await outsider.json()) as { reason?: string }).reason).toBe('entry_not_entered');
    const m100 = await api.post(`${base}/${compId}/meet/results`, { data: { contestId: c100.id, marks: [{ entryId: eA, mark: '11.85', wind: 1.2 }, { entryId: eC, mark: '12.10' }, { entryId: eD, dq: true }] } });
    expect(m100.ok(), await readErrorBody(m100)).toBe(true);
    const placed = ((await m100.json()) as { placed: Array<{ entryId: string; place: number | null; mark: string | null; dq: boolean }> }).placed;
    expect(placed).toEqual([{ entryId: eA, name: eA, place: 1, mark: '11.85s', dq: false }, { entryId: eC, name: eC, place: 2, mark: '12.10s', dq: false }, { entryId: eD, name: eD, place: null, mark: null, dq: true }]);
    const m200 = await api.post(`${base}/${compId}/meet/results`, { data: { contestId: c200.id, marks: [{ entryId: eC, mark: '23.50' }, { entryId: eA, mark: '24.00' }, { entryId: eD, mark: '24.80' }] } });
    expect(m200.ok(), await readErrorBody(m200)).toBe(true);

    // The contest place: a leaderboard by the event's rule, D unranked.
    const view = await api.get(`/api/contests/${c100.id}`);
    expect(view.ok(), await readErrorBody(view)).toBe(true);
    // The contest API answers `{ access, view, publicSitePath }` — the outcome sits under `view`.
    const outcome = ((await view.json()) as { view: { outcome: { kind: string; direction?: string; columns?: Array<{ label: string }>; rows?: Array<{ entryId: string; rank: number | null }> } } }).view.outcome;
    expect(outcome.kind).toBe('leaderboard');
    expect(outcome.direction).toBe('asc');
    expect(outcome.columns?.[0]?.label).toBe('100m mark');
    expect(outcome.rows?.map(r => [r.entryId, r.rank])).toEqual([[eA, 1], [eC, 2], [eD, null]]);

    // The team standings: Blue 8 + 10 + 6 = 24 with a gold, a silver and a bronze; Red 10 + 8 = 18. Both events completed.
    const d = (await (await api.get(`${base}/${compId}`)).json()) as Detail;
    expect(d.contests.filter(c => c.stage === 1).map(c => c.status)).toEqual(['completed', 'completed']);
    expect(d.standingsColumns.map(c => c.key)).toEqual(['points', 'golds', 'silvers', 'bronzes']);
    expect(d.standings.map(r => [r.entrant_name.split(' ')[0], r.rank, r.points, r.stats.golds, r.stats.silvers, r.stats.bronzes])).toEqual([['Blue', 1, 24, 1, 1, 1], ['Red', 2, 18, 1, 1, 0]]);
    const { data: teamEntries } = await admin.from('competition_entries').select('team_id').eq('competition_id', compId).not('team_id', 'is', null);
    expect((teamEntries ?? []).map(t => t.team_id).sort()).toEqual([red, blue].sort());

    // The record: one stat line per athlete per event (none for the DQ), each with its performance row.
    const { data: lines } = await admin.from('contest_stat_lines').select('id, profile_id, stats').eq('contest_id', c100.id);
    expect((lines ?? []).map(l => l.profile_id).sort()).toEqual([athleteA.id, athleteC.id].sort());
    expect((lines ?? []).find(l => l.profile_id === athleteA.id)?.stats).toEqual({ time_100m: 11.85 });
    const perf = await admin.from('athlete_performances').select('natural_key, metrics').in('natural_key', (lines ?? []).map(l => `contest_stat_line:${l.id}`));
    if (!perf.error) {
      expect(perf.data).toHaveLength(2);
      expect((perf.data ?? []).map(r => (r.metrics as Record<string, number>).time_100m).sort()).toEqual([11.85, 12.1]);
    }
    // Leftovers PR 4: session 1 on the calendar — ONE event, both contests share it; a re-publish moves it and keeps the id; a new event adopts it; cancel propagates only when every contest is out.
    const pub = await api.post(`${base}/${compId}/meet/sessions/publish`, { data: { competitionId: compId, session: 1, startsAt: '2030-06-01T16:00:00.000Z', timezone: 'America/Denver' } });
    expect(pub.status(), await readErrorBody(pub)).toBe(201);
    const { eventId } = (await pub.json()) as { eventId: string; created: boolean };
    const ev = await admin.from('events').select('title, starts_at, ends_at, timezone, org_id, category, status').eq('id', eventId).single();
    expect(ev.data).toMatchObject({ title: 'Spring Meet — Session 1', timezone: 'America/Denver', league_id: leagueId, category: 'game', status: 'active' });
    expect(Date.parse(ev.data!.starts_at as string)).toBe(Date.parse('2030-06-01T16:00:00Z'));
    expect(Date.parse(ev.data!.ends_at as string) - Date.parse(ev.data!.starts_at as string)).toBe(180 * 60_000);
    const shared = await admin.from('contests').select('id, event_id, scheduled_at').eq('competition_id', compId).eq('stage', 1);
    expect((shared.data ?? []).map(c => c.event_id)).toEqual([eventId, eventId]);
    expect(new Set((shared.data ?? []).map(c => Date.parse(c.scheduled_at as string)))).toEqual(new Set([Date.parse('2030-06-01T16:00:00Z')]));
    const moved = await api.post(`${base}/${compId}/meet/sessions/publish`, { data: { competitionId: compId, session: 1, startsAt: '2030-06-01T17:00:00.000Z', endsAt: '2030-06-01T21:00:00.000Z', timezone: 'America/Denver' } });
    expect(moved.status(), await readErrorBody(moved)).toBe(200);
    expect(((await moved.json()) as { eventId: string }).eventId).toBe(eventId);
    const movedEv = await admin.from('events').select('starts_at, ends_at').eq('id', eventId).single();
    expect([Date.parse(movedEv.data!.starts_at as string), Date.parse(movedEv.data!.ends_at as string)]).toEqual([Date.parse('2030-06-01T17:00:00Z'), Date.parse('2030-06-01T21:00:00Z')]);
    const more = await api.post(`${base}/${compId}/meet/events`, { data: { competitionId: compId, eventKeys: ['time_400m'], session: 1 } });
    expect(more.status(), await readErrorBody(more)).toBe(201);
    const c400 = ((await more.json()) as { created: Array<{ id: string }> }).created[0];
    const adopted = await admin.from('contests').select('event_id, scheduled_at').eq('id', c400.id).single();
    expect(adopted.data?.event_id).toBe(eventId);
    expect(Date.parse(adopted.data!.scheduled_at as string)).toBe(Date.parse('2030-06-01T17:00:00Z'));
    expect((await api.post(`${base}/${compId}/meet/sessions/publish`, { data: { competitionId: compId, session: 9, startsAt: '2030-06-01T16:00:00.000Z' } })).status()).toBe(404);
    // One contest out → the event stays; every contest out → cancelled.
    for (const id of [c100.id, c200.id]) expect((await api.patch(`${base}/${compId}/contests`, { data: { id, status: 'canceled' } })).ok()).toBe(true);
    expect((await admin.from('events').select('status').eq('id', eventId).single()).data?.status).toBe('active');
    expect((await api.patch(`${base}/${compId}/contests`, { data: { id: c400.id, status: 'canceled' } })).ok()).toBe(true);
    expect((await admin.from('events').select('status').eq('id', eventId).single()).data?.status).toBe('cancelled');
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
