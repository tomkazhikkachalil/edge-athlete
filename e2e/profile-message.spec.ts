import { test, expect, type Browser, type Page } from '@playwright/test';
import { adminClient, apiAs, loadQaUser } from './helpers/qa-user';

// The Message door (Oct 14 2026, Tom's fix 4): on another athlete's profile,
// beside Become a Fan, one tap opens the conversation with them — existing or
// new — and lands in the chat with the composer focused. The target's
// messaging permission refuses with the API's own words and the viewer stays
// on the profile. Both routes.

const userA = () => loadQaUser('user.json');
const userB = () => loadQaUser('user-b.json');
const probeHandle = () => `msgqa${userA().id.replace(/-/g, '').slice(0, 10)}`;

async function directConversationsBetween(): Promise<number> {
  const admin = adminClient();
  const { data: mine } = await admin
    .from('conversation_participants')
    .select('conversation_id, conversation:conversations!inner(id, type)')
    .eq('profile_id', userB().id)
    .eq('conversation.type', 'direct');
  const ids = (mine ?? []).map(r => r.conversation_id);
  if (ids.length === 0) return 0;
  const { data: theirs } = await admin
    .from('conversation_participants')
    .select('conversation_id')
    .in('conversation_id', ids)
    .eq('profile_id', userA().id);
  return (theirs ?? []).length;
}

/** B taps Message on A's profile and lands in the thread, composer ready. */
async function messageFrom(page: Page, path: string, label: string) {
  await page.goto(path);
  const button = page.locator('[data-profile-stats] [data-profile-message]');
  await expect(button, `${label}: the Message button in the stats row`).toBeVisible({ timeout: 25_000 });
  // Beside the fan button, the same height.
  const fan = page.locator('[data-profile-actions]').getByRole('button', { name: /^(Become a Fan|Fan|Requested)$/ });
  await expect(fan).toBeVisible({ timeout: 15_000 });
  const mb = (await button.boundingBox())!;
  const fb = (await fan.boundingBox())!;
  expect(Math.abs(mb.height - fb.height), `${label}: a matched pair`).toBeLessThanOrEqual(2);
  expect(Math.abs(mb.y - fb.y), `${label}: on one line`).toBeLessThanOrEqual(2);
  await button.click();
  await expect(page).toHaveURL(/\/messages\?c=[0-9a-f-]+/, { timeout: 20_000 });
  const composer = page.getByPlaceholder('Message…');
  await expect(composer).toBeVisible({ timeout: 20_000 });
  await expect(composer, `${label}: the composer takes focus`).toBeFocused({ timeout: 10_000 });
  // The flag is consumed: a refresh does not refocus.
  await expect(page).not.toHaveURL(/compose=1/, { timeout: 10_000 });
}

async function run(browser: Browser, viewport: { width: number; height: number } | null, label: string) {
  const admin = adminClient();
  const a = userA();
  await admin.from('profiles').update({ visibility: 'public', handle: probeHandle(), messaging_permission: 'everyone' }).eq('id', a.id);
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', ...(viewport ? { viewport } : {}) });
  const api = await apiAs('state-b.json');
  try {
    const page = await ctx.newPage();
    await messageFrom(page, `/athlete/${a.id}`, `${label} /athlete/[id]`);
    const url1 = page.url();
    // A message goes through from here (the field empties, then the bubble —
    // the text is in the textarea too until it does, the direct-message rule).
    const stamp = `qa-door-${Date.now()}`;
    await page.getByPlaceholder('Message…').fill(stamp);
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByPlaceholder('Message…')).toHaveValue('', { timeout: 20_000 });
    // Exact: the conversation list's preview reads "You: <stamp>" and is
    // hidden on a phone — the bubble is the one exact match.
    await expect(page.getByText(stamp, { exact: true })).toBeVisible({ timeout: 15_000 });
    const before = await directConversationsBetween();
    expect(before).toBe(1);
    // Again, from the other route: the SAME conversation, no duplicate.
    await messageFrom(page, `/u/@${probeHandle()}`, `${label} /u/`);
    expect(page.url().split('&')[0]).toBe(url1.split('&')[0]);
    expect(await directConversationsBetween()).toBe(1);
    // Fans only, B not a fan: the API's words, and B stays on the profile.
    await admin.from('profiles').update({ messaging_permission: 'fans_only' }).eq('id', a.id);
    await admin.from('follows').delete().eq('follower_id', userB().id).eq('following_id', a.id);
    await page.goto(`/athlete/${a.id}`);
    await page.locator('[data-profile-stats] [data-profile-message]').click();
    await expect(page.getByRole('alert').filter({ hasText: 'only accepts messages from their fans' })).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(new RegExp(`/athlete/${a.id}`));
  } finally {
    await api.dispose();
    await ctx.close();
    await admin.from('profiles').update({ visibility: 'private', handle: null, messaging_permission: 'everyone' }).eq('id', a.id);
  }
}

test('Message from a profile opens the one conversation, composer ready; a refusal keeps you on the profile', async ({ browser }) => {
  test.setTimeout(180_000);
  await run(browser, null, 'desktop');
});

test('Message from a profile at a phone width @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  await run(browser, { width: 375, height: 812 }, 'phone');
});
