import { createHash, randomBytes } from 'crypto';
import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// The stub-org claim (phase 1 round 2): a service-role-seeded ownerless
// club + hashed invite → a signed-in user claims it → owner column +
// owner membership row + consumed token; a second visit hits the
// uniform invalid state (single-use).
test('org claim: signed-in claim → ownership + consumed token; reuse invalid', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const claimer = loadQaUser('user.json');
  const admin = adminClient();

  const probe = await admin.from('org_claim_invites').select('id').limit(1);
  test.skip(!!probe.error, `org_claim_invites missing — run migration 149 (${probe.error?.message})`);

  const stamp = Date.now();
  const name = `QA Stub Claim Club ${stamp}`;
  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  const { data: club, error } = await admin
    .from('clubs')
    .insert({ name, owner_profile_id: null })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const clubId = club!.id as string;

  try {
    const { error: inviteError } = await admin.from('org_claim_invites').insert({
      token_hash: tokenHash,
      club_id: clubId,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(inviteError, inviteError?.message).toBeNull();

    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json' });
    try {
      const page = await ctx.newPage();
      await page.goto(`/org-claim/${rawToken}`);
      await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: `Claim ${name}` }).click();
      await expect(page.getByText(`${name} is yours`)).toBeVisible({ timeout: 15_000 });

      // DB truth: owner column + membership row + consumed token.
      const { data: owned } = await admin
        .from('clubs')
        .select('owner_profile_id')
        .eq('id', clubId)
        .single();
      expect(owned!.owner_profile_id).toBe(claimer.id);
      const { data: rows } = await admin
        .from('memberships')
        .select('role, kind')
        .eq('club_id', clubId)
        .eq('profile_id', claimer.id);
      expect(rows).toEqual([{ role: 'owner', kind: 'follow' }]);
      const { data: invite } = await admin
        .from('org_claim_invites')
        .select('consumed_at, consumed_by')
        .eq('token_hash', tokenHash)
        .single();
      expect(invite!.consumed_at).not.toBeNull();
      expect(invite!.consumed_by).toBe(claimer.id);

      // Single-use: a fresh visit lands on the invalid state.
      await page.goto(`/org-claim/${rawToken}`);
      await expect(page.getByText('This link has expired or was already used')).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await ctx.close();
    }
  } finally {
    await admin.from('org_claim_invites').delete().eq('token_hash', tokenHash);
    await admin.from('clubs').delete().eq('id', clubId);
  }
});
