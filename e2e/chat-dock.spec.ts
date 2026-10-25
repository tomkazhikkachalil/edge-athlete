import { test, expect } from './helpers/test';
import { apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Chat dock UX round: minimize-to-dock from the full Messages page, the
// close-is-pill-only rule, and fresh-login restore of a closed dock.
// Desktop-only feature — the config's 1280×720 default viewport passes the
// dock's (min-width:1024px) and (min-height:600px) gate.

async function seedDm(stamp: number): Promise<string> {
  const userB = loadQaUser('user-b.json');
  const apiA = await apiAs('state.json');
  try {
    const convRes = await apiA.post('/api/messages', {
      data: { type: 'direct', participantId: userB.id },
    });
    expect(convRes.ok(), await readErrorBody(convRes)).toBe(true);
    const conversationId = (await convRes.json()).conversationId as string;
    const msgRes = await apiA.post(`/api/messages/${conversationId}/messages`, {
      data: { type: 'text', content: `qa-dock-${stamp}` },
    });
    expect(msgRes.ok(), await readErrorBody(msgRes)).toBe(true);
    return conversationId;
  } finally {
    await apiA.dispose();
  }
}

test('minimize to dock: /messages → /feed with the chat open, un-hiding a closed dock', async ({ page }) => {
  const stamp = Date.now();
  const conversationId = await seedDm(stamp);

  // Pre-seed the persisted close so this also pins the un-hide behavior.
  // addInitScript is safe here because the test has exactly ONE document
  // load (the goto below); the /feed transition is a soft router.push, so
  // the script cannot re-seed the key after minimize clears it.
  await page.context().addInitScript(() => {
    window.localStorage.setItem('ea:chat-dock-hidden:v1', '1');
  });

  await page.goto(`/messages?c=${conversationId}`);
  await expect(page.getByText(`qa-dock-${stamp}`).first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Minimize to chat dock' }).click();

  await expect(page).toHaveURL(/\/feed/);
  await expect(page.getByTestId('mini-chat-window')).toBeVisible({ timeout: 15_000 });
  // The widget is back too — opening a chat un-hides a closed dock…
  await expect(page.getByTestId('chat-widget')).toBeVisible();
  // …by clearing the persisted preference, not just this render.
  expect(
    await page.evaluate(() => window.localStorage.getItem('ea:chat-dock-hidden:v1'))
  ).toBeNull();
});

test('closing the pill leaves chats alone; minimized chat is a labeled pill', async ({ page }) => {
  const stamp = Date.now();
  const conversationId = await seedDm(stamp);

  // Fastest reliable way to get a dock window open: the feature under test.
  await page.goto(`/messages?c=${conversationId}`);
  await expect(page.getByText(`qa-dock-${stamp}`).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Minimize to chat dock' }).click();
  await expect(page.getByTestId('mini-chat-window')).toBeVisible({ timeout: 15_000 });

  // Close the dock via the expanded bar's X: widget gone, chat untouched.
  await page.getByRole('button', { name: 'Messages dock' }).click();
  await page.getByRole('button', { name: 'Close messages' }).click();
  await expect(page.getByTestId('chat-widget')).toHaveCount(0);
  await expect(page.getByTestId('mini-chat-window')).toBeVisible();

  // Minimize the window: it becomes a labeled pill (avatar + name), still
  // with no widget on screen. The window stays mounted but hidden.
  await page.getByTestId('mini-chat-window').getByRole('button', { name: 'Minimize', exact: true }).click();
  await expect(page.getByTestId('mini-chat-window')).toBeHidden();
  const restorePill = page.getByRole('button', { name: /^Restore chat with/ });
  await expect(restorePill).toBeVisible();
  await expect(page.getByTestId('chat-widget')).toHaveCount(0);

  // Restore round-trips; close (the only way a chat disappears) removes it.
  await restorePill.click();
  await expect(page.getByTestId('mini-chat-window')).toBeVisible();
  await page.getByTestId('mini-chat-window').getByRole('button', { name: 'Close chat', exact: true }).click();
  await expect(page.getByTestId('mini-chat-window')).toHaveCount(0);
});

// Scale fix 3 (Oct 25 2026): the conversation list no longer holds one
// Realtime channel per conversation. Its live signal is the `new_message`
// bell on the ONE per-user notifications channel → one list refresh. With
// the thread NOT open, a message B sends via the API must reach A's dock
// (the preview and the unread badge) with no reload and no poll (the poll
// is 2 minutes; the budget here is 20 s).
test('a message to a closed thread bumps the dock list and badge live', async ({ page }) => {
  const stamp = Date.now();
  const conversationId = await seedDm(stamp);

  await page.goto('/feed');
  // Open the dock panel (the collapsed pill is the whole click target) so the
  // list is on screen; the thread itself stays closed.
  await page.getByRole('button', { name: 'Messages dock' }).click();
  await expect(page.getByTestId('dock-panel')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('dock-panel').getByText(`qa-dock-${stamp}`).first()).toBeVisible({ timeout: 15_000 });

  // Now B replies via the API — A's tab is simply watching.
  const apiB = await apiAs('state-b.json');
  try {
    const res = await apiB.post(`/api/messages/${conversationId}/messages`, {
      data: { type: 'text', content: `qa-live-${stamp}` },
    });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
  } finally {
    await apiB.dispose();
  }

  // The preview is the list's state (last_message), so its arrival IS the
  // refresh: no reload, no 2-minute poll — the bell did it.
  await expect(page.getByTestId('dock-panel').getByText(`qa-live-${stamp}`).first()).toBeVisible({ timeout: 20_000 });
});

test('fresh login restores a closed dock', async ({ browser }) => {
  const user = loadQaUser('user.json');
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/anon.json' });
  try {
    const page = await ctx.newPage();
    // `?signin=1`: the launch gate (Sep 30 2026) sends a signed-out `/` to
    // coming-soon on production and lets the login form through here only;
    // harmless when the gate is off (auth-login.spec's rule).
    await page.goto('/?signin=1');
    // Simulate "closed the dock in a previous session" — page.evaluate, NOT
    // addInitScript (which re-runs on every document load and would re-seed
    // the key after signIn clears it).
    await page.evaluate(() => window.localStorage.setItem('ea:chat-dock-hidden:v1', '1'));

    await page.locator('input[name="email"]').fill(user.email);
    await page.locator('input[name="password"]').fill(user.password);
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    await page.waitForURL('**/athlete', { timeout: 20_000 });

    // The login cleared the preference: pill present without any toggle.
    await expect(page.getByTestId('chat-widget')).toBeVisible({ timeout: 15_000 });
    expect(
      await page.evaluate(() => window.localStorage.getItem('ea:chat-dock-hidden:v1'))
    ).toBeNull();
  } finally {
    await ctx.close();
  }
});
