import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// The league open-join loop (migration 113): creation is admin-provisioned,
// so the league is seeded directly via the service role (no admin cookie
// needed — the API-seed-then-UI-assert template). QA user B owns it; user A
// (the default storage state) joins and leaves from /league/[id], and every
// count assertion is server-truth re-rendered, never optimistic.
test('league: join and leave from the league page', async ({ page }) => {
  test.setTimeout(120_000);
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const admin = adminClient();

  // Self-skip until migration 113 has been applied to the target database
  // (the people-location-search precedent).
  const probe = await admin.from('leagues').select('id').limit(1);
  test.skip(!!probe.error, `leagues table missing — run migration 113 (${probe.error?.message})`);

  const stamp = Date.now();
  const name = `QA League ${stamp}`;

  const { data: league, error } = await admin
    .from('leagues')
    .insert({
      name,
      sport_key: 'golf',
      description: 'e2e probe league',
      owner_profile_id: userB.id,
    })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  const { error: memberError } = await admin
    .from('league_members')
    .insert({ league_id: leagueId, profile_id: userB.id, role: 'owner' });
  expect(memberError, memberError?.message).toBeNull();

  try {
    await page.goto(`/league/${leagueId}`);
    await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('1 member', { exact: false })).toBeVisible();

    // Join → server truth re-render shows Leave + 2 members.
    await page.getByRole('button', { name: 'Join league' }).click();
    await expect(page.getByRole('button', { name: 'Leave league' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('2 members')).toBeVisible();

    // The owner was notified (best-effort insert — assert the row landed).
    const { data: notif } = await admin
      .from('notifications')
      .select('id')
      .eq('user_id', userB.id)
      .eq('type', 'league_join')
      .eq('actor_id', userA.id);
    expect((notif ?? []).length).toBeGreaterThan(0);

    // Leave → back to 1 member.
    await page.getByRole('button', { name: 'Leave league' }).click();
    // Dummy-proofing round: leaving confirms first (a manager would lose
    // their role) — the confirm appearing IS part of the contract now.
    await expect(page.getByText('Leave this league?')).toBeVisible();
    await page.getByRole('button', { name: 'Leave', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Join league' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('1 member', { exact: false })).toBeVisible();
  } finally {
    await admin.from('notifications').delete().eq('type', 'league_join').eq('actor_id', userA.id);
    // Members cascade with the league row; the doc-sync delete trigger
    // removes its search document.
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
