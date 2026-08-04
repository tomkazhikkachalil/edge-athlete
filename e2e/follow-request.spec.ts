import { test, expect } from '@playwright/test';
import { loadQaUser } from './helpers/qa-user';

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
