import { test, expect } from './helpers/test';
import { createQaOrg, deleteQaOrgs, rosterSeasonId } from './helpers/org';
import { adminClient, apiAs, deleteQaUser, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Scale audit row 12 (Nov 7 2026): a pasted roster of 50 athletes used to be
// 50 × 5 SEQUENTIAL admin operations (two Auth calls, the stub RPC, the three
// membership rows, the claim invite). The import now mints each stub with ONE
// Auth call (the id is the caller's, so the stub address needs no re-key) and
// runs the rows a few at a time; the report keeps the pasted order and every
// row still compensates itself. This spec is the measurement AND the pin: a
// full batch lands every row, every stub carries its three membership rows and
// one live claim invite, and the wall time is logged. Production keeps the
// probe small (the stubs are deleted either way).
const ROWS = process.env.E2E_TARGET === 'prod' ? 12 : 50;

test(`a pasted roster of ${ROWS} athletes imports as one batch — every row landed, in order, with its memberships and claim link`, async () => {
  test.setTimeout(300_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'roster-import', owner.id);
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA Import League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  await admin.from('memberships').insert({ org_id: league.id, profile_id: owner.id, kind: 'follow', role: 'owner', status: 'active' });
  const { data: team, error: teamError } = await admin.from('teams').insert({ org_id: league.id, name: `Importers ${stamp}` }).select('id').single();
  expect(teamError, teamError?.message).toBeNull();
  const teamId = team!.id as string;
  const seasonId = await rosterSeasonId(admin, league.id);
  const names = Array.from({ length: ROWS }, (_, i) => ({ first: `Batch${i + 1}`, last: `Importtest${stamp}` }));
  const text = names.map(n => `${n.first} ${n.last}`).join('\n');
  const ownerApi = await apiAs('state-b.json');
  const stubIds: string[] = [];
  try {
    const started = Date.now();
    const res = await ownerApi.post(`/api/leagues/${league.id}/roster-import`, { data: { teamId, text }, timeout: 280_000 });
    const ms = Date.now() - started;
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const body = await res.json() as { report: Array<{ name: string; profileId: string | null; claimUrl: string | null; error?: string }>; lineErrors: unknown[] };
    console.log(`[roster-import-batch] ${ROWS} rows imported in ${ms} ms (${Math.round(ms / ROWS)} ms per row)`);
    // Every minted stub is ours to delete, whatever the assertions below say.
    for (const row of body.report ?? []) if (row.profileId) stubIds.push(row.profileId);
    expect(body.lineErrors).toEqual([]);
    expect(body.report).toHaveLength(ROWS);
    const failed = body.report.map((row, i) => (row.error ? `row ${i + 1} (${row.name}): ${row.error}` : null)).filter(Boolean);
    expect(failed, 'every row landed').toEqual([]);
    body.report.forEach((row, i) => {
      expect(row.name, 'the report keeps the pasted order').toBe(`${names[i].first} ${names[i].last}`);
      expect(row.profileId).toBeTruthy();
      expect(row.claimUrl).toMatch(/\/athlete-claim\/[A-Za-z0-9_-]+$/);
    });
    expect(new Set(stubIds).size, 'fifty distinct stubs').toBe(ROWS);

    // Every stub: a stub address, the three membership rows (org follow, org
    // roster, TEAM roster in the season), one live claim invite.
    const [{ data: profiles }, { data: members }, { data: invites }] = await Promise.all([
      admin.from('profiles').select('id, email, first_name, last_name').in('id', stubIds),
      admin.from('memberships').select('profile_id, kind, scope_type, scope_id, season_id, status').eq('org_id', league.id).in('profile_id', stubIds),
      admin.from('athlete_claim_invites').select('profile_id').in('profile_id', stubIds).is('consumed_at', null),
    ]);
    expect(profiles).toHaveLength(ROWS);
    for (const p of profiles ?? []) {
      expect(p.email).toBe(`${p.id}@stubs.invalid`);
      expect(p.last_name).toBe(`Importtest${stamp}`);
    }
    expect(members).toHaveLength(ROWS * 3);
    for (const id of stubIds) {
      const mine = (members ?? []).filter(m => m.profile_id === id);
      expect(mine.map(m => `${m.kind}:${m.scope_type}:${m.scope_id ?? '-'}:${m.season_id ?? '-'}:${m.status}`).sort()).toEqual([
        `follow:org:-:-:active`,
        `roster:org:-:-:active`,
        `roster:team:${teamId}:${seasonId}:active`,
      ].sort());
    }
    expect(invites).toHaveLength(ROWS);
  } finally {
    await ownerApi.dispose();
    // The stubs first (their access rows and invites go with them), then the org.
    for (let i = 0; i < stubIds.length; i += 5) {
      await Promise.all(stubIds.slice(i, i + 5).map(id => deleteQaUser(id)));
    }
    await deleteQaOrgs(admin, [league.id]);
  }
});
