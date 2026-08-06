import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// Full follow-request loop between two PRIVATE users: A requests from B's
// profile (reached by direct URL — athlete search is public-only, so private
// users are invisible to it; FollowButton renders on PrivateProfileView),
// B approves on the Fan Requests tab, A sees the acceptance notification.
test('follow request: A requests, B approves, A is notified', async ({ page, browser }) => {
  const userB = loadQaUser('user-b.json');

  // A sends the request from B's (private) profile.
  await page.goto(`/athlete/${userB.id}`);
  await page.getByRole('button', { name: 'Become a Fan' }).click();
  await page.getByRole('button', { name: 'Send Request' }).click();
  await expect(page.getByRole('button', { name: 'Requested' })).toBeVisible({ timeout: 15_000 });

  // B approves.
  const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
  try {
    const pageB = await ctxB.newPage();
    await pageB.goto('/app/followers?tab=requests');
    // Request rows render first+last ("Edge Alpha"), NOT display_name — most
    // non-messaging surfaces compose names via formatDisplayName(first, last).
    // "Edge Alpha" is not a substring of "Edge QA Alpha", so this stays exact.
    const row = pageB.getByText('Edge Alpha').first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await pageB.getByRole('button', { name: 'Accept' }).first().click();
    await expect(pageB.getByRole('button', { name: 'Accept' })).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await ctxB.close();
  }

  // A sees the acceptance. Copy from getNotificationText (src/lib/
  // notifications.tsx), whose actorName is formatDisplayName(first, last)
  // → "Edge Bravo", not the display_name.
  await page.goto('/app/notifications');
  await expect(page.getByText('Edge Bravo accepted your fan request').first())
    .toBeVisible({ timeout: 15_000 });
});

// Public profiles follow in ONE click: no request modal, straight to "Fan",
// and the target gets the new_follower notification (DB trigger on the
// accepted insert — the server has always written accepted for public
// targets; the button just stopped forcing the request UI on them).
// Runs AFTER the private test (workers: 1): A unfollowed nobody — the
// accepted A→B follow from above is deleted here first so the click is a
// fresh follow, not an unfollow toggle.
test('public profile: one-click follow, no request modal', async ({ page, browser }) => {
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  await adminClient().from('follows').delete().eq('follower_id', userA.id).eq('following_id', userB.id);
  await adminClient().from('profiles').update({ visibility: 'public' }).eq('id', userB.id);
  try {
    // A follows B in one click — the modal must never appear.
    await page.goto(`/athlete/${userB.id}`);
    await page.getByRole('button', { name: 'Become a Fan' }).click();
    await expect(page.getByRole('button', { name: 'Fan', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Send Request' })).toHaveCount(0);

    // The counter row reads Fans → Following → Posts, in order (own page).
    // The "N Fans" button's parent IS the stats row.
    await page.goto('/athlete');
    const statsRow = page.getByRole('button', { name: /Fans$/ }).first().locator('..');
    await expect(statsRow).toContainText(/Fans[\s\S]*Following[\s\S]*Posts/);

    // B was notified — the no-action new_follower type, not a request.
    const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const pageB = await ctxB.newPage();
      await pageB.goto('/app/notifications');
      await expect(pageB.getByText('Edge Alpha is now your fan').first())
        .toBeVisible({ timeout: 15_000 });
      await expect(pageB.getByText('Edge Alpha sent you a follow request')).toHaveCount(0);
    } finally {
      await ctxB.close();
    }
  } finally {
    // B back to private — later specs (and the QA default) rely on it.
    await adminClient().from('profiles').update({ visibility: 'private' }).eq('id', userB.id);
  }
});
