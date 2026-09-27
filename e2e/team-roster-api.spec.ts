import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, createQaChild, deleteQaUser, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Teams & divisions program, PR 4 (Sep 26 2026): the team roster API.
// B owns a club with a live season and two teams. A is a rostered member,
// C a member who is not on the roster, D a stranger with a supervised child
// on the roster. The spec walks add → move → remove through the one writer,
// the refusals by name, the gate (a plain member is refused), and the bells
// (the player hears; a supervised child's guardian gets the copy).

test('team roster API: add, move, remove in the season; refusals by name; members refused; bells to the player and the guardian', async () => {
  test.setTimeout(180_000);
  const owner = loadQaUser('user-b.json');
  const alpha = loadQaUser('user.json');
  const charlie = loadQaUser('user-c.json');
  const delta = loadQaUser('user-d.json');
  const admin = adminClient();
  const probe = await admin.from('teams').select('sport_key').limit(1);
  test.skip(!!probe.error, `teams.sport_key missing — run migration 242 (${probe.error?.message})`);
  await resetRateBucket(admin, 'org-structure', owner.id);

  const stamp = Date.now();
  const club = await createQaOrg(admin, 'club', { name: `QA Roster Club ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  const childId = await createQaChild(delta.id, { firstName: 'Riley', handle: `qa_riley_${stamp}` });
  const ownerApi = await apiAs('state-b.json');
  const alphaApi = await apiAs('state.json');
  try {
    const { data: season } = await admin.from('seasons').insert({ org_id: club.id, label: `Roster ${stamp}` }).select('id').single();
    const { data: teams } = await admin.from('teams').insert([{ org_id: club.id, name: `Blazers ${stamp}` }, { org_id: club.id, name: `Comets ${stamp}` }]).select('id, name');
    const [blazers, comets] = teams!.sort((a, b) => (a.name as string).localeCompare(b.name as string)) as { id: string; name: string }[];
    await admin.from('memberships').insert([
      { org_id: club.id, profile_id: owner.id, kind: 'follow', role: 'owner', status: 'active' },
      { org_id: club.id, profile_id: alpha.id, kind: 'follow', role: 'member', status: 'active' },
      { org_id: club.id, profile_id: alpha.id, kind: 'roster', role: 'member', status: 'active' },
      { org_id: club.id, profile_id: charlie.id, kind: 'follow', role: 'member', status: 'active' },
      { org_id: club.id, profile_id: childId, kind: 'follow', role: 'member', status: 'active' },
      { org_id: club.id, profile_id: childId, kind: 'roster', role: 'member', status: 'active' },
    ]);
    const roster = (teamId: string) => `/api/clubs/${club.id}/teams/${teamId}/roster`;

    // A plain member can't manage a team roster.
    let res = await alphaApi.post(roster(blazers.id), { data: { profileId: charlie.id } });
    expect(res.status(), await readErrorBody(res)).toBe(403);

    // Refusals by name: C is not on the roster; D is not a member.
    res = await ownerApi.post(roster(blazers.id), { data: { profileId: charlie.id } });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('needs_org_roster');
    res = await ownerApi.post(roster(blazers.id), { data: { profileId: delta.id } });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('not_member');

    // Add A: the row names the season; the bell reaches A.
    res = await ownerApi.post(roster(blazers.id), { data: { profileId: alpha.id } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await res.json()).seasonId).toBe(season!.id);
    const { data: spot } = await admin.from('memberships').select('season_id, status').eq('profile_id', alpha.id).eq('scope_type', 'team').eq('scope_id', blazers.id).single();
    expect(spot).toEqual({ season_id: season!.id, status: 'active' });
    res = await ownerApi.post(roster(blazers.id), { data: { profileId: alpha.id } });
    expect(res.status()).toBe(409);

    // The roster read + the candidates (C shows, not on the roster yet).
    res = await ownerApi.get(`${roster(blazers.id)}?candidates=1`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const view = (await res.json()) as { roster: { profileId: string }[]; candidates: { profileId: string; onRoster: boolean }[] };
    expect(view.roster.map(r => r.profileId)).toEqual([alpha.id]);
    expect(view.candidates.find(c => c.profileId === charlie.id)).toMatchObject({ onRoster: false });
    expect(view.candidates.some(c => c.profileId === alpha.id)).toBe(false);

    // Move A to Comets: one row, same season.
    res = await ownerApi.patch(roster(blazers.id), { data: { profileId: alpha.id, toTeamId: comets.id } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { data: afterMove } = await admin.from('memberships').select('scope_id, season_id').eq('profile_id', alpha.id).eq('scope_type', 'team');
    expect(afterMove).toEqual([{ scope_id: comets.id, season_id: season!.id }]);

    // Remove A from Comets.
    res = await ownerApi.delete(roster(comets.id), { data: { profileId: alpha.id } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await admin.from('memberships').select('id').eq('profile_id', alpha.id).eq('scope_type', 'team')).data).toEqual([]);

    // A heard all three.
    const { data: bells } = await admin.from('notifications').select('metadata, title').eq('user_id', alpha.id).eq('type', 'team_roster');
    expect((bells ?? []).map(b => (b.metadata as { team_roster: string }).team_roster).sort()).toEqual(['added', 'moved', 'removed']);

    // The supervised child: added from the roster; the guardian gets the copy naming them.
    res = await ownerApi.post(roster(blazers.id), { data: { profileId: childId } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { data: guardianBells } = await admin.from('notifications').select('title, metadata').eq('user_id', delta.id).eq('type', 'team_roster');
    expect(guardianBells!.some(b => b.title.startsWith('Riley was added to') && (b.metadata as { profile_id?: string }).profile_id === childId)).toBe(true);
  } finally {
    await ownerApi.dispose();
    await alphaApi.dispose();
    await deleteQaOrgs(admin, [club.id]);
    await deleteQaUser(childId);
  }
});
