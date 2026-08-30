import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// Club manager appointment — mirror of league-managers.spec.ts; also
// asserts the long-dormant 'club_update' type's first real send.
test('club managers: owner promotes and demotes; non-owners see no controls', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('memberships').select('club_id').limit(1);
  test.skip(!!probe.error, `memberships missing — run migration 140 (${probe.error?.message})`);

  const name = `QA Mgr Club ${Date.now()}`;
  const { data: club, error } = await admin
    .from('clubs')
    .insert({ name, owner_profile_id: userB.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const clubId = club!.id as string;
  const { error: memberError } = await admin.from('memberships').insert([
    { club_id: clubId, profile_id: userB.id, role: 'owner' },
    { club_id: clubId, profile_id: userA.id, role: 'member' },
  ]);
  expect(memberError, memberError?.message).toBeNull();

  try {
    await page.goto(`/club/${clubId}`);
    await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Make manager' })).toHaveCount(0);

    const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const pageB = await ctxB.newPage();
      await pageB.goto(`/club/${clubId}`);
      await pageB.getByRole('button', { name: 'Make manager' }).click();
      await expect(pageB.getByText('manager', { exact: true })).toBeVisible({ timeout: 15_000 });

      const { data: notif } = await admin
        .from('notifications')
        .select('id')
        .eq('user_id', userA.id)
        .eq('type', 'club_update');
      expect((notif ?? []).length).toBeGreaterThan(0);

      await pageB.getByRole('button', { name: 'Remove manager' }).click();
      await expect(pageB.getByRole('button', { name: 'Make manager' })).toBeVisible({ timeout: 15_000 });
      await expect(pageB.getByText('manager', { exact: true })).toHaveCount(0);
    } finally {
      await ctxB.close();
    }
  } finally {
    await admin.from('notifications').delete().eq('type', 'club_update').eq('user_id', userA.id);
    await admin.from('clubs').delete().eq('id', clubId);
  }
});
