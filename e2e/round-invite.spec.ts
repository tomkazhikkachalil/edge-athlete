import { test, expect } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Shared-round invite: A creates a golf round with B as participant via API
// (the composer's Tag People search is public-only, so a private B is
// invisible there), and B receives the group_invite notification. There is
// no follow/visibility gate on participants — the round creator may add any
// profile. Teardown: the round is A's group_posts row, deleted by the
// existing golf chain in deleteQaUser.
test('round invite: A adds B to a shared round, B is notified', async ({ browser }) => {
  const userB = loadQaUser('user-b.json');
  const stamp = Date.now();

  const apiA = await apiAs('state.json');
  try {
    const res = await apiA.post('/api/group-posts', {
      data: {
        type: 'golf_round',
        title: `QA Shared Round ${stamp}`,
        date: new Date().toISOString().split('T')[0],
        participant_ids: [userB.id],
      },
    });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
  } finally {
    await apiA.dispose();
  }

  // B sees the invite notification (group_invite renders the DB title — no
  // getNotificationText case; visible on the default "All" tab). The title
  // is built by notifyGroupInvites from first+last → "Edge Alpha".
  const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
  try {
    const pageB = await ctxB.newPage();
    await pageB.goto('/app/notifications');
    await expect(pageB.getByText('Edge Alpha added you to a shared round').first())
      .toBeVisible({ timeout: 15_000 });
  } finally {
    await ctxB.close();
  }
});
