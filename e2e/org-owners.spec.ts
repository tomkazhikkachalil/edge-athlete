import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Multiple owners + transfer (0.8): B (owner) promotes A to co-owner via
// confirm; A steps down; B's step-down is blocked as last owner. Cache
// assertions at each step (primary = earliest-joined; EXPLICIT distinct
// joined_at seeds — batch inserts share a timestamp and the id tie-break
// would otherwise decide). API edges: role PATCH on an owner row still 400;
// DELETE /owners with a foreign profileId is the no-coup 400.
test('org owners: promote co-owner, step down, last-owner blocked', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('memberships').select('id').limit(1);
  test.skip(!!probe.error, `memberships missing — run migration 140 (${probe.error?.message})`);

  const name = `QA Owners League ${Date.now()}`;
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'golf', owner_profile_id: userB.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  const { error: memberError } = await admin.from('memberships').insert([
    { league_id: leagueId, profile_id: userB.id, role: 'owner', joined_at: '2026-01-01T00:00:00Z' },
    { league_id: leagueId, profile_id: userA.id, role: 'member', joined_at: '2026-02-01T00:00:00Z' },
  ]);
  expect(memberError, memberError?.message).toBeNull();

  const cachedOwner = async () => {
    const { data } = await admin.from('leagues').select('owner_profile_id').eq('id', leagueId).single();
    return data?.owner_profile_id as string | null;
  };

  try {
    // B promotes A through the confirm.
    const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const pageB = await ctxB.newPage();
      await pageB.goto(`/league/${leagueId}`);
      await pageB.getByRole('button', { name: 'Make owner' }).click();
      await pageB.getByRole('button', { name: 'Make owner', exact: true }).last().click();
      // A's row now reads owner (raw DOM text; CSS capitalizes).
      await expect(pageB.getByText('owner', { exact: true })).toHaveCount(2, { timeout: 15_000 });
    } finally {
      await ctxB.close();
    }

    // Server truth: two owner rows; cache still B (earliest-joined).
    const { data: ownerRows } = await admin
      .from('memberships')
      .select('profile_id')
      .eq('league_id', leagueId)
      .eq('role', 'owner');
    expect((ownerRows ?? []).map(r => r.profile_id).sort()).toEqual([userA.id, userB.id].sort());
    expect(await cachedOwner()).toBe(userB.id);

    // A got the owner notification.
    const { data: notif } = await admin
      .from('notifications')
      .select('title')
      .eq('user_id', userA.id)
      .eq('type', 'league_update')
      .contains('metadata', { role: 'owner', league_id: leagueId });
    expect(notif).toHaveLength(1);
    expect(notif![0].title).toBe(`You're now an owner of ${name}`);

    // API edges while two owners exist: role PATCH on an owner row → 400;
    // foreign-profileId DELETE → the no-coup 400.
    const apiB = await apiAs('state-b.json');
    try {
      const rolePatch = await apiB.patch(`/api/leagues/${leagueId}/members?profileId=${userA.id}`, {
        data: { role: 'member' },
      });
      expect(rolePatch.status(), await readErrorBody(rolePatch)).toBe(400);
      const coup = await apiB.delete(`/api/leagues/${leagueId}/owners?profileId=${userA.id}`);
      expect(coup.status(), await readErrorBody(coup)).toBe(400);
      expect((await coup.json()).error).toContain("Owners can't remove each other");
    } finally {
      await apiB.dispose();
    }

    // A (default context) steps down → back to a manager row; cache stays B.
    await page.goto(`/league/${leagueId}`);
    await page.getByRole('button', { name: 'Step down as owner' }).click();
    await page.getByRole('button', { name: 'Step down', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Step down as owner' })).toHaveCount(0, {
      timeout: 15_000,
    });
    const { data: afterRows } = await admin
      .from('memberships')
      .select('profile_id, role')
      .eq('league_id', leagueId)
      .eq('profile_id', userA.id)
      .eq('kind', 'follow');
    expect(afterRows).toHaveLength(1);
    expect(afterRows![0].role).toBe('manager');
    expect(await cachedOwner()).toBe(userB.id);

    // B is now the last owner: step-down blocked with the exact body.
    const apiB2 = await apiAs('state-b.json');
    try {
      const last = await apiB2.delete(`/api/leagues/${leagueId}/owners`);
      expect(last.status(), await readErrorBody(last)).toBe(400);
      expect((await last.json()).error).toContain("last owner");
    } finally {
      await apiB2.dispose();
    }
  } finally {
    await admin.from('notifications').delete().eq('type', 'league_update').eq('user_id', userA.id);
    await admin.from('leagues').delete().eq('id', leagueId); // memberships cascade
  }
});
