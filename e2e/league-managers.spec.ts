import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// Manager appointment (owner-only): A is a plain member and must see no role
// controls; B (the owner) promotes A — Manager badge appears from server
// truth and A gets the league_update notification — then demotes. Two-user
// template from follow-request.spec.ts; service-role seed (creation is
// admin-provisioned).
test('league managers: owner promotes and demotes; non-owners see no controls', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('leagues').select('id').limit(1);
  test.skip(!!probe.error, `leagues table missing — run migration 113 (${probe.error?.message})`);

  const name = `QA Mgr League ${Date.now()}`;
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'golf', owner_profile_id: userB.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  const { error: memberError } = await admin.from('league_members').insert([
    { league_id: leagueId, profile_id: userB.id, role: 'owner' },
    { league_id: leagueId, profile_id: userA.id, role: 'member' },
  ]);
  expect(memberError, memberError?.message).toBeNull();

  try {
    // A (member, not owner) sees the league but no role controls.
    await page.goto(`/league/${leagueId}`);
    await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Make manager' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remove manager' })).toHaveCount(0);

    // B (owner) promotes A.
    const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const pageB = await ctxB.newPage();
      await pageB.goto(`/league/${leagueId}`);
      await pageB.getByRole('button', { name: 'Make manager' }).click();
      // Server-truth re-render: the role badge (DOM text is the raw role;
      // CSS capitalizes it) and the demote button both appear.
      await expect(pageB.getByText('manager', { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(pageB.getByRole('button', { name: 'Remove manager' })).toBeVisible();

      // A got the front-loaded league_update type's first real send.
      const { data: notif } = await admin
        .from('notifications')
        .select('id, title')
        .eq('user_id', userA.id)
        .eq('type', 'league_update');
      expect((notif ?? []).length).toBeGreaterThan(0);

      // Demote back.
      await pageB.getByRole('button', { name: 'Remove manager' }).click();
      await expect(pageB.getByRole('button', { name: 'Make manager' })).toBeVisible({ timeout: 15_000 });
      await expect(pageB.getByText('manager', { exact: true })).toHaveCount(0);
    } finally {
      await ctxB.close();
    }
  } finally {
    await admin.from('notifications').delete().eq('type', 'league_update').eq('user_id', userA.id);
    await admin.from('leagues').delete().eq('id', leagueId); // members cascade
  }
});
