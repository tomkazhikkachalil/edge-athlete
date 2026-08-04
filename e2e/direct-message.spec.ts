import { test, expect } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// DM loop: conversation + first message created via API as A (the New Message
// modal's athlete search is public-only, so private users can't find each
// other through the UI), then B reads and replies in the real UI, and A sees
// the reply. Privacy does not block DMs (messaging_permission defaults to
// 'everyone').
test('direct message: A sends via API, B reads and replies in UI, A sees reply', async ({ page }) => {
  const userB = loadQaUser('user-b.json');
  const stamp = Date.now();

  const apiA = await apiAs('state.json');
  let conversationId: string;
  try {
    const convRes = await apiA.post('/api/messages', {
      data: { type: 'direct', participantId: userB.id },
    });
    expect(convRes.ok(), await readErrorBody(convRes)).toBe(true);
    conversationId = (await convRes.json()).conversationId;

    const msgRes = await apiA.post(`/api/messages/${conversationId}/messages`, {
      data: { type: 'text', content: `qa-dm-${stamp}` },
    });
    expect(msgRes.ok(), await readErrorBody(msgRes)).toBe(true);
  } finally {
    await apiA.dispose();
  }

  // B reads the message and replies in the UI (1280px viewport = split pane).
  const ctxB = await page.context().browser()!.newContext({
    storageState: 'e2e/.auth/state-b.json',
  });
  try {
    const pageB = await ctxB.newPage();
    await pageB.goto(`/messages?c=${conversationId}`);
    await expect(pageB.getByText(`qa-dm-${stamp}`).first()).toBeVisible({ timeout: 15_000 });
    await pageB.getByPlaceholder('Message…').fill(`qa-reply-${stamp}`);
    await pageB.getByRole('button', { name: 'Send message' }).click();
    await expect(pageB.getByText(`qa-reply-${stamp}`).first()).toBeVisible({ timeout: 15_000 });

    // B also received a notification for A's message (title copy is the DB
    // title — new_message has no getNotificationText case; "All" tab only).
    await pageB.goto('/app/notifications');
    await expect(pageB.getByText('Edge QA Alpha sent you a message').first())
      .toBeVisible({ timeout: 15_000 });
  } finally {
    await ctxB.close();
  }

  // A sees B's reply in the UI. B's send renders optimistically, so B's
  // assertion can pass before the server write lands — poll with reloads
  // instead of trusting a single page load.
  await page.goto(`/messages?c=${conversationId}`);
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(`qa-reply-${stamp}`).first()).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
});
