import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

/**
 * Competition formats (track 2), PR 3 — a knockout bracket through the
 * API. NEEDS MIGRATION 218 ON THE TARGET (self-skips before). The owner (B)
 * creates a bracket competition on an admin-minted league, enters five
 * teams, seeds them (a duplicate refused), generates (the dry run reports a
 * field of 8, one quarterfinal, three byes; the real run mints the staged
 * contests), then plays it: a tied quarterfinal needs its decision; the
 * winner advances into the semifinal by slot; a result on the unfilled
 * final is refused; the final decides the champion; the standings are the
 * progression (1 · 2 · 3 · 3 · 5).
 */
type Detail = { contests: Array<{ id: string; stage: number | null; slot: number | null; round: string | null; status: string; participants: Array<{ id: string; entry_id: string; side: string | null }> }>; standings: Array<{ entry_id: string; rank: number; stats: Record<string, number> }>; standingsColumns: Array<{ key: string }> };

test('bracket API: seeds, generate (dry + real), the tie decision, advancement by slot, the unfilled slot, the progression standings', async () => {
  test.setTimeout(150_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  const probe = await admin.from('contests').select('stage').limit(1);
  test.skip(!!probe.error, 'contests.stage missing — run migration 218');
  const api = await apiAs('state-b.json');
  const stamp = Date.now();
  const { data: league, error } = await admin.from('leagues').insert({ name: `QA Bracket League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id }).select().single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  try {
    await admin.from('memberships').insert([{ league_id: leagueId, profile_id: owner.id, role: 'owner' }]);
    const { data: season } = await admin.from('seasons').insert({ league_id: leagueId, label: '2026-27' }).select().single();
    const seasonId = season!.id as string;
    const { data: teams } = await admin.from('teams').insert(Array.from({ length: 5 }, (_, i) => ({ league_id: leagueId, name: `Seed ${i + 1} ${stamp}` }))).select('id, name');
    const teamIds = (teams ?? []).sort((a, b) => a.name.localeCompare(b.name)).map(t => t.id as string);
    expect(teamIds).toHaveLength(5);
    const base = `/api/leagues/${leagueId}/competitions`;

    // A bracket competition (creatable since PR 3); a meet still is not.
    const meet = await api.post(base, { data: { side: 'league', orgId: leagueId, seasonId, sportKey: 'ice_hockey', name: 'Meet', format: 'meet', visibility: 'public' } });
    expect(meet.status()).toBe(400);
    const created = await api.post(base, { data: { side: 'league', orgId: leagueId, seasonId, sportKey: 'ice_hockey', name: 'Playoffs', format: 'bracket', visibility: 'public' } });
    expect(created.ok(), await readErrorBody(created)).toBe(true);
    const compBody = (await created.json()) as { competition?: { id: string; entrant_type: string }; id?: string; entrant_type?: string };
    const compId = compBody.competition?.id ?? compBody.id!;
    expect(compBody.competition?.entrant_type ?? compBody.entrant_type).toBe('team');
    const entryIds: string[] = [];
    for (const teamId of teamIds) {
      const res = await api.post(`${base}/entries`, { data: { competitionId: compId, teamId } });
      expect(res.ok(), await readErrorBody(res)).toBe(true);
      const b = (await res.json()) as { entry?: { id: string }; id?: string };
      entryIds.push(b.entry?.id ?? b.id!);
    }
    const [e1, e2, e3, e4, e5] = entryIds;

    // Seeds: the full order; a duplicate is refused by name.
    const dup = await api.put(`${base}/${compId}/seeds`, { data: { competitionId: compId, entryIds: [e1, e1, e3] } });
    expect(dup.status()).toBe(400);
    expect(await readErrorBody(dup)).toMatch(/twice/);
    const seeded = await api.put(`${base}/${compId}/seeds`, { data: { competitionId: compId, entryIds } });
    expect(seeded.ok(), await readErrorBody(seeded)).toBe(true);

    // Generate: the dry run reports; the real run mints the staged contests.
    const dry = await api.post(`${base}/${compId}/bracket`, { data: { competitionId: compId, dryRun: true } });
    expect(dry.ok(), await readErrorBody(dry)).toBe(true);
    expect((await dry.json()).report).toMatchObject({ dryRun: true, size: 8, stages: 3, contests: 4, byes: 3, replaced: 0 });
    const gen = await api.post(`${base}/${compId}/bracket`, { data: { competitionId: compId, dryRun: false } });
    expect(gen.status(), await readErrorBody(gen)).toBe(201);
    // Seeds are frozen once drawn.
    expect((await api.put(`${base}/${compId}/seeds`, { data: { competitionId: compId, entryIds } })).status()).toBe(409);

    const detail = async () => (await (await api.get(`${base}/${compId}`)).json()) as Detail;
    let d = await detail();
    const staged = d.contests.filter(c => c.stage !== null);
    expect(staged).toHaveLength(4);
    const qf = staged.find(c => c.stage === 1)!;
    expect(qf).toMatchObject({ slot: 2, round: 'Quarterfinals' });
    expect(qf.participants.map(p => [p.side, p.entry_id]).sort()).toEqual([['away', e5], ['home', e4]]);
    const sf1 = staged.find(c => c.stage === 2 && c.slot === 1)!;
    const sf2 = staged.find(c => c.stage === 2 && c.slot === 2)!;
    const final = staged.find(c => c.stage === 3)!;
    expect(sf1.participants.map(p => [p.side, p.entry_id])).toEqual([['home', e1]]);
    expect(sf2.participants.map(p => [p.side, p.entry_id]).sort()).toEqual([['away', e3], ['home', e2]]);
    expect(final.participants).toEqual([]);
    expect(d.standingsColumns.map(c => c.key)).toEqual(['reached', 'w', 'l']);

    // A result on the unfilled final → 409 slot_unfilled.
    const early = await api.post(`${base}/${compId}/results`, { data: { contestId: final.id, results: [] } });
    expect(early.status()).toBe(400); // zod: min 1 result
    const pid = (c: Detail['contests'][number], side: string) => c.participants.find(p => p.side === side)!.id;
    // The quarterfinal: a tie without a decision is refused; with one, the away side advances.
    const tie = await api.post(`${base}/${compId}/results`, { data: { contestId: qf.id, results: [{ participantId: pid(qf, 'home'), score: 2 }, { participantId: pid(qf, 'away'), score: 2 }] } });
    expect(tie.status()).toBe(400);
    expect(((await tie.json()) as { reason?: string }).reason).toBe('tie_needs_decision');
    const decided = await api.post(`${base}/${compId}/results`, { data: { contestId: qf.id, results: [{ participantId: pid(qf, 'home'), score: 2 }, { participantId: pid(qf, 'away'), score: 2, payload: { advance: 'shootout' } }] } });
    expect(decided.ok(), await readErrorBody(decided)).toBe(true);
    d = await detail();
    const sf1b = d.contests.find(c => c.id === sf1.id)!;
    expect(sf1b.participants.map(p => [p.side, p.entry_id]).sort()).toEqual([['away', e5], ['home', e1]]);
    // The final is still unfilled → 409 by name.
    const finalNow = d.contests.find(c => c.id === final.id)!;
    expect(finalNow.participants).toEqual([]);
    const unfilled = await api.post(`${base}/${compId}/results`, { data: { contestId: final.id, results: [{ participantId: pid(sf1b, 'home'), score: 1 }] } });
    expect(unfilled.status()).toBe(400); // a participant outside this game
    // The semifinals.
    expect((await api.post(`${base}/${compId}/results`, { data: { contestId: sf1.id, results: [{ participantId: pid(sf1b, 'home'), score: 3 }, { participantId: pid(sf1b, 'away'), score: 1 }] } })).ok()).toBe(true);
    const sf2b = d.contests.find(c => c.id === sf2.id)!;
    expect((await api.post(`${base}/${compId}/results`, { data: { contestId: sf2.id, results: [{ participantId: pid(sf2b, 'home'), score: 4 }, { participantId: pid(sf2b, 'away'), score: 0 }] } })).ok()).toBe(true);
    d = await detail();
    const finalB = d.contests.find(c => c.id === final.id)!;
    expect(finalB.participants.map(p => [p.side, p.entry_id]).sort()).toEqual([['away', e2], ['home', e1]]);
    expect((await api.post(`${base}/${compId}/results`, { data: { contestId: final.id, results: [{ participantId: pid(finalB, 'home'), score: 2 }, { participantId: pid(finalB, 'away'), score: 5 }] } })).ok()).toBe(true);
    // Regenerate is refused once results exist.
    expect((await api.post(`${base}/${compId}/bracket`, { data: { competitionId: compId, dryRun: false } })).status()).toBe(409);
    // The progression: e2 champion, e1 runner-up, e5 and e3 share 3, e4 fifth.
    d = await detail();
    expect(d.standings.map(r => [r.entry_id, r.rank])).toEqual([[e2, 1], [e1, 2], [e5, 3], [e3, 3], [e4, 5]]);
    expect(d.standings[0].stats).toMatchObject({ reached: 3, w: 2, l: 0 });
    // The contest place carries the stage and the round name.
    const view = await api.get(`/api/contests/${final.id}`);
    expect(view.ok(), await readErrorBody(view)).toBe(true);
    expect(((await view.json()) as { contest: { stage: number; slot: number; roundName: string }; outcome: { kind: string; winnerEntryId: string } }).contest).toMatchObject({ stage: 3, slot: 1, roundName: 'Final' });
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
    await api.dispose();
  }
});
