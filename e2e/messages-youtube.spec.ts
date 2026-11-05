import { test, expect } from './helpers/test';
import { apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Videos program, Phase 1b: a YouTube link in a text message is a
// click-to-play poster under the bubble — a preview, never a row. The link
// with `t=` seeks on the tap. The text keeps the link as typed.
test('a YouTube link in a message shows the poster; the tap mounts the frame at t=', async ({ page }) => {
  test.setTimeout(120_000);
  const userB = loadQaUser('user-b.json');
  const stamp = Date.now();
  const apiA = await apiAs('state.json');
  let conversationId: string;
  try {
    const convRes = await apiA.post('/api/messages', { data: { type: 'direct', participantId: userB.id } });
    expect(convRes.ok(), await readErrorBody(convRes)).toBe(true);
    conversationId = (await convRes.json()).conversationId;
    const msgRes = await apiA.post(`/api/messages/${conversationId}/messages`, { data: { type: 'text', content: `qa-yt-${stamp} watch this https://youtu.be/jNQXAC9IVRw?t=12 — the elephant` } });
    expect(msgRes.ok(), await readErrorBody(msgRes)).toBe(true);
  } finally {
    await apiA.dispose();
  }
  await page.goto(`/messages?c=${conversationId}`);
  await expect(page.getByText(`qa-yt-${stamp}`).first()).toBeVisible({ timeout: 15_000 });
  const preview = page.locator('[data-message-youtube="jNQXAC9IVRw"]').first();
  await expect(preview).toBeVisible();
  await expect(preview.locator('iframe')).toHaveCount(0);
  await preview.locator('[data-video-poster]').click();
  await expect(preview.locator('iframe')).toHaveAttribute('src', /youtube-nocookie\.com\/embed\/jNQXAC9IVRw\?rel=0&start=12&autoplay=1/, { timeout: 10_000 });
});
