import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// Org activity (connections PR D): a PUBLIC member's public post appears in
// the club's Recent activity; a private member's post does not (the /u/
// rule: post public AND author public). QA user A is flipped public for the
// spec and restored in teardown.
test('org activity: public member post shows, private member post does not', async ({ page }) => {
  test.setTimeout(120_000);
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('club_members').select('club_id').limit(1);
  test.skip(!!probe.error, `club_members missing — run migration 117 (${probe.error?.message})`);

  const stamp = Date.now();
  const clubName = `QA Activity Club ${stamp}`;
  const publicCaption = `Public activity probe ${stamp}`;
  const privateCaption = `Private activity probe ${stamp}`;

  const { data: club, error } = await admin
    .from('clubs')
    .insert({ name: clubName, owner_profile_id: userB.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const clubId = club!.id as string;
  await admin.from('club_members').insert([
    { club_id: clubId, profile_id: userB.id, role: 'owner' },
    { club_id: clubId, profile_id: userA.id, role: 'member' },
  ]);

  // A goes public and posts; B stays private and posts.
  await admin.from('profiles').update({ visibility: 'public' }).eq('id', userA.id);
  const { data: postA } = await admin
    .from('posts')
    .insert({ profile_id: userA.id, caption: publicCaption, visibility: 'public', status: 'published', sport_key: 'general' })
    .select()
    .single();
  const { data: postB } = await admin
    .from('posts')
    .insert({ profile_id: userB.id, caption: privateCaption, visibility: 'public', status: 'published', sport_key: 'general' })
    .select()
    .single();

  try {
    await page.goto(`/club/${clubId}`);
    await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(publicCaption)).toBeVisible();
    // B's profile is private → their post is excluded by the author rule.
    await expect(page.getByText(privateCaption)).toHaveCount(0);
  } finally {
    if (postA) await admin.from('posts').delete().eq('id', postA.id);
    if (postB) await admin.from('posts').delete().eq('id', postB.id);
    await admin.from('profiles').update({ visibility: 'private' }).eq('id', userA.id);
    await admin.from('clubs').delete().eq('id', clubId);
  }
});
