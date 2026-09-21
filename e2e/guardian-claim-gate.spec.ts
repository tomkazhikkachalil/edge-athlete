import { test, expect } from '@playwright/test';
import { adminClient, apiAs, createQaUser, deleteQaUser, guardianFlagOn, loadQaUser, mintStorageState, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Round 1 PR 1 (Sep 2026) — the guardian claim gate. Alpha (a guardian)
// creates a managed athlete and invites a co-guardian; an account created
// AFTER the invite was minted is refused the claim by name (the path a minor
// would take to mint their own "parent"), while bravo — an account older than
// the invite — is admitted. Guardian-flag-gated like its siblings. @mobile.

test('a guardian invite is claimable only by an account older than the invite @mobile', async ({ browser }) => {
  test.skip(!guardianFlagOn(), 'guardian flag off in this environment');
  test.setTimeout(120_000);
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const bravo = loadQaUser('user-b.json');
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  await resetRateBucket(admin, 'guardian-athlete-create', alpha.id);
  await resetRateBucket(admin, 'invite-claim', bravo.id);
  const rand = Math.random().toString(36).slice(2, 8);
  let childId: string | null = null;
  let newcomerId: string | null = null;
  try {
    const dob = new Date(Date.UTC(new Date().getUTCFullYear() - 10, 5, 15)).toISOString().split('T')[0];
    let res = await apiA.post('/api/guardian/athletes', { data: { first_name: 'Junior', last_name: 'Gate', dob, handle: `qagate${rand}` } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    childId = (await res.json()).profileId as string;

    // The invite, minted NOW.
    res = await apiA.post(`/api/guardian/athletes/${childId}/guardians`, { data: { email: `edgeqa-newparent-${rand}@example.com` } });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    const token = String((await res.json()).inviteUrl).split('/invite/')[1];
    expect(token?.length).toBeGreaterThan(20);

    // An account created AFTER the invite (what a minor minting their own "parent" looks like) is refused by name.
    const newcomer = await createQaUser({ email: `edgeqa-newparent-${rand}@example.com`, displayName: 'New Parent', firstName: 'New', lastName: 'Parent' });
    newcomerId = newcomer.id;
    const newcomerApi = (await browser.newContext({ storageState: await mintStorageState(newcomer) })).request;
    await resetRateBucket(admin, 'invite-claim', newcomer.id);
    res = await newcomerApi.post(`/api/invites/${token}/claim`);
    expect(res.status()).toBe(403);
    expect((await res.json()).code).toBe('guardian_account_too_new');
    // Refused means NOT consumed and NOT granted.
    const { data: rows } = await admin.from('profile_access').select('user_id').eq('profile_id', childId).eq('user_id', newcomer.id);
    expect(rows ?? []).toEqual([]);

    // Bravo — an account older than the invite — claims it.
    res = await apiB.post(`/api/invites/${token}/claim`);
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    const { data: granted } = await admin.from('profile_access').select('role').eq('profile_id', childId).eq('user_id', bravo.id).maybeSingle();
    expect(granted?.role).toBe('guardian');
  } finally {
    if (newcomerId) await deleteQaUser(newcomerId);
    if (childId) {
      // The guardian-console spec's cleanup: the API's own delete (the parked-then-purge path is the deletion engine's).
      const res = await apiA.delete(`/api/guardian/athletes/${childId}`, { data: { confirmHandle: `qagate${rand}` } });
      if (!res.ok()) {
        await admin.from('profile_access').delete().eq('profile_id', childId);
        await admin.from('guardian_invites').delete().eq('profile_id', childId);
        await admin.from('profiles').delete().eq('id', childId);
        await admin.auth.admin.deleteUser(childId).catch(() => null);
      }
    }
  }
});
