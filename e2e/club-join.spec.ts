import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// The club open-join loop (migration 117) — mirror of league-join.spec.ts.
// QA user B owns the seeded club; user A joins and leaves from /club/[id],
// every count assertion server-truth.
test('club: join and leave from the club page', async ({ page }) => {
  test.setTimeout(120_000);
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('club_members').select('club_id').limit(1);
  test.skip(!!probe.error, `club_members missing — run migration 117 (${probe.error?.message})`);

  const stamp = Date.now();
  const name = `QA Club ${stamp}`;

  const { data: club, error } = await admin
    .from('clubs')
    .insert({ name, description: 'e2e probe club', owner_profile_id: userB.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const clubId = club!.id as string;
  const { error: memberError } = await admin
    .from('club_members')
    .insert({ club_id: clubId, profile_id: userB.id, role: 'owner' });
  expect(memberError, memberError?.message).toBeNull();

  try {
    await page.goto(`/club/${clubId}`);
    await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('1 member', { exact: false })).toBeVisible();

    await page.getByRole('button', { name: 'Join club' }).click();
    await expect(page.getByRole('button', { name: 'Leave club' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('2 members')).toBeVisible();

    const { data: notif } = await admin
      .from('notifications')
      .select('id')
      .eq('user_id', userB.id)
      .eq('type', 'club_join')
      .eq('actor_id', userA.id);
    expect((notif ?? []).length).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Leave club' }).click();
    await expect(page.getByRole('button', { name: 'Join club' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('1 member', { exact: false })).toBeVisible();
  } finally {
    await admin.from('notifications').delete().eq('type', 'club_join').eq('actor_id', userA.id);
    await admin.from('clubs').delete().eq('id', clubId); // members cascade
  }
});
