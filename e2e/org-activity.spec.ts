import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';
import { cleanRoundPost, seedRoundPost } from './helpers/member-photos';
import { openWindow } from './helpers/org-page';

// Org activity (connections PR D): a PUBLIC member's public post appears in
// the club's Recent activity; a private member's post does not (the /u/
// rule: post public AND author public). QA user A is flipped public for the
// spec and restored in teardown.
test('org activity: public member post shows, private member post does not', async ({ page }) => {
  test.setTimeout(120_000);
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('memberships').select('club_id').limit(1);
  test.skip(!!probe.error, `memberships missing — run migration 140 (${probe.error?.message})`);

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
  await admin.from('memberships').insert([
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
  // R4: a public post WITH media — its thumbnail must come through the
  // signed proxy (the uploads bucket is private; a raw URL 404s).
  const mediaPost = await seedRoundPost(admin, userA.id, { stamp: `${stamp}`, visibility: 'public' });

  try {
    await page.goto(`/club/${clubId}`);
    // R3: the list lives behind the Recent activity bubble.
    const win = await openWindow(page, 'activity');
    await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(publicCaption)).toBeVisible();
    // B's profile is private → their post is excluded by the author rule.
    await expect(page.getByText(privateCaption)).toHaveCount(0);
    // R4: the media post's thumbnail rides the signed proxy (never a raw
    // private-bucket URL) and actually serves — asserted on the read first,
    // so a wrong URL form fails with the URL in the message, then on the DOM.
    const activityRes = await page.request.get(`/api/clubs/${clubId}/activity`);
    expect(activityRes.status()).toBe(200);
    const rows = ((await activityRes.json()) as { activity: Array<{ id: string; thumbUrl: string | null }> }).activity;
    const mediaRow = rows.find(r => r.id === mediaPost.postId);
    expect(mediaRow, 'the media post is in the activity list').toBeTruthy();
    expect(mediaRow!.thumbUrl, `thumbUrl should be a proxy path, got ${mediaRow!.thumbUrl}`).toMatch(/^\/api\/media\//);
    expect((await page.request.get(mediaRow!.thumbUrl!)).status()).toBe(200);
    // next/image writes the absolute form of a relative src — match the path.
    const thumb = win.locator(`img[src$="${mediaRow!.thumbUrl}"]`);
    // Diagnostic on failure: what image-ish elements the window holds.
    const rendered = await win.evaluate(el =>
      Array.from(el.querySelectorAll('img, [role="img"]')).map(e => e.outerHTML.slice(0, 220))
    );
    await expect(thumb, `window images: ${JSON.stringify(rendered)}`).toBeVisible({ timeout: 15_000 });
  } finally {
    await cleanRoundPost(admin, mediaPost);
    if (postA) await admin.from('posts').delete().eq('id', postA.id);
    if (postB) await admin.from('posts').delete().eq('id', postB.id);
    await admin.from('profiles').update({ visibility: 'private' }).eq('id', userA.id);
    await admin.from('clubs').delete().eq('id', clubId);
  }
});
