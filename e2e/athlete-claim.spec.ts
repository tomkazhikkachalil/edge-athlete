import { createHash, randomBytes } from 'crypto';
import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// The stub-athlete claim (phase 1 R3), both paths against seeded stubs.
// Adult: ACCOUNTLESS — email+password activates the stub AS the claimer's
// account (supervised self row → owner, supervision self, signed in).
// Guardian: signed-in — guardian row granted, supervised SELF ROW DELETED
// (the has-login marker; keeping it suppresses credentials_gap), email
// re-keyed @minors.invalid, roster stays ACTIVE.

async function seedStub(admin: ReturnType<typeof adminClient>, leagueId: string, firstName: string) {
  const { data: created, error } = await admin.auth.admin.createUser({
    email: `pending-${randomBytes(8).toString('hex')}@stubs.invalid`,
    password: randomBytes(32).toString('base64url'),
    email_confirm: true,
  });
  expect(error, error?.message).toBeNull();
  const id = created!.user!.id;
  await admin.auth.admin.updateUserById(id, { email: `${id}@stubs.invalid`, email_confirm: true });
  const { error: rpcError } = await admin.rpc('create_stub_profile', {
    p_id: id,
    p_email: `${id}@stubs.invalid`,
    p_first_name: firstName,
    p_last_name: 'Stubson',
    p_created_by: id,
  });
  expect(rpcError, rpcError?.message).toBeNull();
  await admin.from('memberships').insert([
    { league_id: leagueId, profile_id: id, kind: 'follow', role: 'member', status: 'active', scope_type: 'org', scope_id: null },
    { league_id: leagueId, profile_id: id, kind: 'roster', role: 'member', status: 'active', scope_type: 'org', scope_id: null },
  ]);
  const rawToken = randomBytes(32).toString('base64url');
  await admin.from('athlete_claim_invites').insert({
    token_hash: createHash('sha256').update(rawToken).digest('hex'),
    profile_id: id,
    league_id: leagueId,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
  return { id, rawToken };
}

test('athlete claim: adult accountless path + guardian path + single-use', async ({ browser }) => {
  test.setTimeout(180_000);
  const guardian = loadQaUser('user.json');
  const admin = adminClient();

  const probe = await admin.from('athlete_claim_invites').select('id').limit(1);
  test.skip(!!probe.error, `athlete_claim_invites missing — run migration 150 (${probe.error?.message})`);

  const stamp = Date.now();
  const { data: league } = await admin
    .from('leagues')
    .insert({ name: `QA Claim League ${stamp}`, sport_key: 'ice_hockey' })
    .select()
    .single();
  const leagueId = league!.id as string;

  const stubIds: string[] = [];
  try {
    // ── ADULT path (signed-out) ───────────────────────────────────────────
    const adult = await seedStub(admin, leagueId, 'Rory');
    stubIds.push(adult.id);
    const claimEmail = `edgeqa-claimed-${stamp.toString(36)}@example.com`;
    const ctxAnon = await browser.newContext();
    try {
      const page = await ctxAnon.newPage();
      await page.goto(`/athlete-claim/${adult.rawToken}`);
      await expect(page.getByRole('heading', { name: 'Rory Stubson' })).toBeVisible({
        timeout: 20_000,
      });
      await page.getByRole('button', { name: /This is me/ }).click();
      await page.getByLabel('Email').fill(claimEmail);
      await page.getByLabel('Password').fill('ClaimMe123!');
      await page.getByRole('button', { name: 'Claim my profile' }).click();
      await expect(page.getByText('The profile is yours')).toBeVisible({ timeout: 20_000 });

      // DB truth: real email, owner self row, self supervision, roster live.
      const { data: prof } = await admin
        .from('profiles')
        .select('email, supervision_state')
        .eq('id', adult.id)
        .single();
      expect(prof!.email).toBe(claimEmail);
      expect(prof!.supervision_state).toBe('self');
      const { data: access } = await admin
        .from('profile_access')
        .select('role')
        .eq('profile_id', adult.id);
      expect(access).toEqual([{ role: 'owner' }]);
      const { data: roster } = await admin
        .from('memberships')
        .select('status')
        .eq('profile_id', adult.id)
        .eq('kind', 'roster')
        .eq('scope_type', 'org');
      expect(roster).toEqual([{ status: 'active' }]);

      // Single-use: revisiting lands invalid.
      await page.goto(`/athlete-claim/${adult.rawToken}`);
      await expect(page.getByText('This link has expired or was already used')).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await ctxAnon.close();
    }

    // ── GUARDIAN path (signed-in QA user) ─────────────────────────────────
    const child = await seedStub(admin, leagueId, 'Maya');
    stubIds.push(child.id);
    const ctxG = await browser.newContext({ storageState: 'e2e/.auth/state.json' });
    try {
      const page = await ctxG.newPage();
      await page.goto(`/athlete-claim/${child.rawToken}`);
      await expect(page.getByRole('heading', { name: 'Maya Stubson' })).toBeVisible({
        timeout: 20_000,
      });
      await page.getByRole('button', { name: /parent or guardian/ }).click();
      await expect(page.getByText('is in your family console')).toBeVisible({ timeout: 20_000 });

      // DB truth: guardian row, NO supervised self row, minors email,
      // still supervised, roster active.
      const { data: access } = await admin
        .from('profile_access')
        .select('role, user_id')
        .eq('profile_id', child.id);
      expect(access).toEqual([{ role: 'guardian', user_id: guardian.id }]);
      const { data: prof } = await admin
        .from('profiles')
        .select('email, supervision_state')
        .eq('id', child.id)
        .single();
      expect(prof!.email).toBe(`${child.id}@minors.invalid`);
      expect(prof!.supervision_state).toBe('supervised');
      const { data: roster } = await admin
        .from('memberships')
        .select('status')
        .eq('profile_id', child.id)
        .eq('kind', 'roster');
      expect(roster).toEqual([{ status: 'active' }]);

      // The credentials_gap PROOF: no self row → the guardian queue
      // surfaces "no login yet" for the claimed child.
      const queueRes = await page.request.get('/api/guardian/queue');
      expect(queueRes.ok()).toBe(true);
      const items = (await queueRes.json()).items as Array<{ kind: string; athlete?: { id: string } }>;
      expect(
        items.some(i => i.kind === 'credentials_gap' && i.athlete?.id === child.id),
        'credentials_gap must surface for the claimed child'
      ).toBe(true);
    } finally {
      await ctxG.close();
    }
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
    for (const id of stubIds) {
      await admin.from('profile_access').delete().eq('profile_id', id);
      await admin.from('profiles').delete().eq('id', id);
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  }
});
