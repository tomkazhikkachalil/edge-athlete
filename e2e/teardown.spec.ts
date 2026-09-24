import { test, expect, request } from '@playwright/test';
import { randomBytes } from 'crypto';
import {
  E2E_BASE_URL, adminClient, bypassHeaders, createQaChild, createQaUser, deleteQaUser, listStaleQaShapes,
  loadQaUser, mintStorageState, readErrorBody, registrationFlagOnTarget, resetRateBucket,
} from './helpers/qa-user';
import { createQaOrg, createdQaOrgIds, deleteQaOrgs } from './helpers/org';
import { SWEEP_CUTOFF_MS } from './helpers/qa-sweep-rules';

// ── The teardown, tested on the target (Sep 24 2026) ────────────────────────
// The suite's own hygiene: the worst-case QA shape is built with the runner's
// helpers and torn down with `deleteQaUser` / `deleteQaOrgs` — the paths the
// global teardown and the 24 h sweep use — and every row must be gone. The
// shapes are the ones that leaked on staging: a contest result ENTERED BY the
// user whose participant cascades in the same statement (the SET NULL quirk),
// a supervised minor whose only guardian is going (the deferred access guard),
// a roster stub (a shadow user no guardian holds), and the orgs an owner's
// deletion never takes (owner_profile_id is SET NULL). Then the sweep's org
// rule is proven on real rows, and the registration bucket is tripped and
// reset for the user who actually posts.

async function seedStub(admin: ReturnType<typeof adminClient>, orgId: string, firstName: string): Promise<string> {
  const { data: created, error } = await admin.auth.admin.createUser({
    email: `pending-${randomBytes(8).toString('hex')}@stubs.invalid`,
    password: randomBytes(32).toString('base64url'),
    email_confirm: true,
  });
  expect(error, error?.message).toBeNull();
  const id = created!.user!.id;
  await admin.auth.admin.updateUserById(id, { email: `${id}@stubs.invalid`, email_confirm: true });
  const { error: rpcError } = await admin.rpc('create_stub_profile', {
    p_id: id, p_email: `${id}@stubs.invalid`, p_first_name: firstName, p_last_name: 'Teardownstub', p_created_by: id,
  });
  expect(rpcError, rpcError?.message).toBeNull();
  const { error: memberError } = await admin.from('memberships').insert([
    { org_id: orgId, profile_id: id, kind: 'follow', role: 'member', status: 'active', scope_type: 'org', scope_id: null },
    { org_id: orgId, profile_id: id, kind: 'roster', role: 'member', status: 'active', scope_type: 'org', scope_id: null },
  ]);
  expect(memberError, memberError?.message).toBeNull();
  return id;
}

async function profileExists(admin: ReturnType<typeof adminClient>, id: string): Promise<boolean> {
  const { data } = await admin.from('profiles').select('id').eq('id', id).maybeSingle();
  return !!data;
}
async function authUserExists(admin: ReturnType<typeof adminClient>, id: string): Promise<boolean> {
  const { data, error } = await admin.auth.admin.getUserById(id);
  return !error && !!data?.user;
}

test('the worst-case QA profile deletes cleanly and leaves nothing: orgs, results entered by the user, minor, stub', async () => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const stamp = Date.now();
  const alpha = loadQaUser('user.json');

  // A user of its own — the four shared users must not be disturbed.
  const t = await createQaUser({ displayName: `Edge QA Teardown ${stamp}`, firstName: 'Edge', lastName: 'Teardown' });
  const league = await createQaOrg(admin, 'league', { name: `QA Teardown League ${stamp}`, sport_key: 'golf', owner_profile_id: t.id });
  const club = await createQaOrg(admin, 'club', { name: `QA Teardown Club ${stamp}`, owner_profile_id: t.id });
  let childSolo: string | null = null;
  let childShared: string | null = null;
  let stubId: string | null = null;
  try {
    // The competition chain with the failing shape: an entry of the user's,
    // a participant, and a result ENTERED BY the user.
    const { data: season, error: seasonError } = await admin.from('seasons').insert({ org_id: league.id, label: `Teardown ${stamp}` }).select('id').single();
    expect(seasonError, seasonError?.message).toBeNull();
    const { data: comp, error: compError } = await admin.from('competitions').insert({
      org_id: league.id, season_id: season!.id, sport_key: 'golf', name: `Teardown Cup ${stamp}`,
      format: 'leaderboard', entrant_type: 'athlete', status: 'active', visibility: 'public',
    }).select('id').single();
    expect(compError, compError?.message).toBeNull();
    const { data: entry, error: entryError } = await admin.from('competition_entries').insert({ competition_id: comp!.id, profile_id: t.id, status: 'approved' }).select('id').single();
    expect(entryError, entryError?.message).toBeNull();
    const { data: contest, error: contestError } = await admin.from('contests').insert({ competition_id: comp!.id, status: 'completed' }).select('id').single();
    expect(contestError, contestError?.message).toBeNull();
    const { data: cp, error: cpError } = await admin.from('contest_participants').insert({ contest_id: contest!.id, entry_id: entry!.id }).select('id').single();
    expect(cpError, cpError?.message).toBeNull();
    const { error: resultError } = await admin.from('contest_results').insert({
      contest_id: contest!.id, participant_id: cp!.id, entered_by: t.id, confirmed_by: t.id, payload: { gross: 72 },
    });
    expect(resultError, resultError?.message).toBeNull();

    // A minor whose ONLY guardian is the user; a minor with a live co-guardian (user A).
    childSolo = await createQaChild(t.id, { firstName: 'Solo', lastName: 'Teardown', handle: `qa-td-solo-${stamp}` });
    childShared = await createQaChild(t.id, { firstName: 'Shared', lastName: 'Teardown', handle: `qa-td-shared-${stamp}` });
    const { error: coError } = await admin.from('profile_access').insert({ profile_id: childShared, user_id: alpha.id, role: 'guardian', granted_by: alpha.id });
    expect(coError, coError?.message).toBeNull();

    // A roster stub of the league — a shadow user no person holds.
    stubId = await seedStub(admin, league.id, `Stub${stamp}`);

    // ── The deletion under test ─────────────────────────────────────────────
    await deleteQaUser(t.id);

    expect(await profileExists(admin, t.id), 'the profile').toBe(false);
    expect(await authUserExists(admin, t.id), 'the auth user').toBe(false);
    expect(await profileExists(admin, childSolo), 'the solo minor goes with its only guardian').toBe(false);
    expect(await authUserExists(admin, childSolo), 'the solo minor\'s shadow user').toBe(false);
    expect(await profileExists(admin, childShared), 'the co-guarded minor survives').toBe(true);
    const { data: sharedAccess } = await admin.from('profile_access').select('user_id').eq('profile_id', childShared);
    expect((sharedAccess ?? []).map(a => a.user_id), 'only the live guardian\'s row remains').toEqual([alpha.id]);
    const { count: results } = await admin.from('contest_results').select('id', { count: 'exact', head: true }).eq('contest_id', contest!.id);
    expect(results, 'the user\'s results went with its entry').toBe(0);
    const { count: entries } = await admin.from('competition_entries').select('id', { count: 'exact', head: true }).eq('competition_id', comp!.id);
    expect(entries).toBe(0);
    // The orgs outlive their owner (SET NULL) — the spec's `finally` / the run's registry take them.
    const { data: orgRow } = await admin.from('organizations').select('owner_profile_id').eq('id', league.id).maybeSingle();
    expect(orgRow?.owner_profile_id, 'owner_profile_id is SET NULL, never a cascade').toBeNull();
    // The stub is org-owned, not person-owned: still here until the org's spec deletes it (or the sweep does).
    expect(await profileExists(admin, stubId), 'a stub is not the user\'s').toBe(true);
    await deleteQaUser(stubId);
    expect(await profileExists(admin, stubId)).toBe(false);
    expect(await authUserExists(admin, stubId), 'the stub\'s shadow user goes with it').toBe(false);
    stubId = null;
  } finally {
    // Idempotent: the user is already gone; the orgs and the co-guarded minor are ours to remove.
    if (childShared) await deleteQaUser(childShared).catch(() => {});
    if (childSolo && (await profileExists(admin, childSolo))) await deleteQaUser(childSolo).catch(() => {});
    if (stubId) await deleteQaUser(stubId).catch(() => {});
    const removed = await deleteQaOrgs(admin, [league.id, club.id]);
    expect(removed, 'deleteQaOrgs reports the rows it removed').toBe(2);
    expect(createdQaOrgIds.has(league.id), 'the run registry forgets a deleted org').toBe(false);
    await deleteQaUser(t.id).catch(() => {});
  }
});

test('the sweep lists a backdated, ownerless QA org and leaves a fresh one and a live-owned one', async () => {
  const admin = adminClient();
  const stamp = Date.now();
  const alpha = loadQaUser('user.json');
  const old = new Date(Date.now() - 25 * 3600_000).toISOString();
  const take = await createQaOrg(admin, 'club', { name: `QA Sweep Take ${stamp}`, owner_profile_id: null });
  const fresh = await createQaOrg(admin, 'club', { name: `QA Sweep Fresh ${stamp}`, owner_profile_id: null });
  const owned = await createQaOrg(admin, 'club', { name: `QA Sweep Owned ${stamp}`, owner_profile_id: alpha.id });
  try {
    for (const id of [take.id, owned.id]) {
      const { error } = await admin.from('organizations').update({ created_at: old }).eq('id', id);
      expect(error, error?.message).toBeNull();
    }
    const { orgs } = await listStaleQaShapes(admin, Date.now() - SWEEP_CUTOFF_MS);
    const listed = new Set(orgs.map(o => o.id));
    expect(listed.has(take.id), 'old + ownerless + QA-named → listed').toBe(true);
    expect(listed.has(fresh.id), 'younger than the cutoff → kept').toBe(false);
    expect(listed.has(owned.id), 'a live owner → kept').toBe(false);
  } finally {
    await deleteQaOrgs(admin, [take.id, fresh.id, owned.id]);
  }
});

test('the registration bucket: 21 posts by the poster trip it; a reset for THAT user clears it', async () => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const stamp = Date.now();
  const t = await createQaUser({ displayName: `Edge QA Bucket ${stamp}`, firstName: 'Edge', lastName: 'Bucket' });
  const state = await mintStorageState(t);
  const api = await request.newContext({ baseURL: E2E_BASE_URL, storageState: state, extraHTTPHeaders: bypassHeaders() });
  const league = await createQaOrg(admin, 'league', { name: `QA Bucket League ${stamp}`, sport_key: 'golf', owner_profile_id: t.id });
  try {
    if (!(await registrationFlagOnTarget(api))) {
      test.skip(true, 'FEATURE_ORG_REGISTRATION is off on this target');
      return;
    }
    const { error: memberError } = await admin.from('memberships').insert({ org_id: league.id, profile_id: t.id, kind: 'follow', role: 'owner', status: 'active', scope_type: 'org', scope_id: null });
    expect(memberError, memberError?.message).toBeNull();
    const { data: season } = await admin.from('seasons').insert({ org_id: league.id, label: `Bucket ${stamp}` }).select('id').single();
    const post = () => api.post(`/api/leagues/${league.id}/registration-windows`, {
      data: { seasonId: season!.id, opensAt: new Date(Date.now() - 60_000).toISOString() },
    });
    // The limit runs BEFORE validation, so every attempt counts — the flag
    // probe above included: the first window lands (200), every later one is
    // the same offering (409), and the 429 arrives at the 21st attempt in the
    // hour, probe counted.
    let attempts = 1; // registrationFlagOnTarget's probe
    const first = await post();
    attempts++;
    expect(first.status(), await readErrorBody(first)).toBe(200);
    let status = 0;
    while (attempts < 25) {
      const res = await post();
      attempts++;
      status = res.status();
      if (status === 429) break;
      expect(status, `attempt ${attempts} counts but is not the limit`).toBe(409);
    }
    expect(status, 'the bucket trips').toBe(429);
    expect(attempts, 'at the 21st attempt in the hour (20 admitted)').toBe(21);
    // A reset for a DIFFERENT user changes nothing (the bug the probes had).
    await resetRateBucket(admin, 'registration', loadQaUser('user-b.json').id);
    expect((await post()).status()).toBe(429);
    // The reset for the poster clears it: the route runs again (and says 409, as before).
    await resetRateBucket(admin, 'registration', t.id);
    const again = await post();
    expect(again.status(), await readErrorBody(again)).toBe(409);
  } finally {
    await api.dispose();
    await deleteQaOrgs(admin, [league.id]);
    await deleteQaUser(t.id);
  }
});
