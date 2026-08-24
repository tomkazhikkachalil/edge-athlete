import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// Org connections PR A: the memberships strip and the feed sidebar card.
// A is a member of a seeded club owned by B; A's own profile page shows the
// Clubs & Leagues strip, and A's feed sidebar card lists the club.
// (/u/ is probed on prod with a real public profile — QA users are private.)
test('profile orgs: strip on own page, card in feed sidebar', async ({ page }) => {
  test.setTimeout(120_000);
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('club_members').select('club_id').limit(1);
  test.skip(!!probe.error, `club_members missing — run migration 117 (${probe.error?.message})`);

  const name = `QA Strip Club ${Date.now()}`;
  const { data: club, error } = await admin
    .from('clubs')
    .insert({ name, owner_profile_id: userB.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const clubId = club!.id as string;
  const { error: memberError } = await admin.from('club_members').insert([
    { club_id: clubId, profile_id: userB.id, role: 'owner' },
    { club_id: clubId, profile_id: userA.id, role: 'member' },
  ]);
  expect(memberError, memberError?.message).toBeNull();

  try {
    // Own profile page: the strip renders the club chip, linking its page.
    await page.goto('/athlete');
    const chip = page.getByRole('link', { name: new RegExp(name) });
    await expect(chip.first()).toBeVisible({ timeout: 15_000 });

    // Feed sidebar: the Your Clubs & Leagues card lists it.
    await page.goto('/feed');
    await expect(page.getByRole('heading', { name: 'Your Clubs & Leagues' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: new RegExp(name) }).first()).toBeVisible();
  } finally {
    await admin.from('clubs').delete().eq('id', clubId); // members cascade
  }
});
