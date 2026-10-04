import { test, expect, type Page } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// Notifications clear (Oct 4 2026). Tom: the bell's dot and the app icon's
// number stayed up after he had looked. Opening the bell or the Notifications
// screen IS seeing them now (Instagram's rule): everything is marked read on
// open and the count goes to zero; the rows new at that moment keep the "new"
// styling for that open. And the paths that never cleared a row are closed:
// a read conversation clears its message bells, a decided fan request is a
// read bell, and a return to the foreground catches up on reads done
// elsewhere (a tap on a phone notification, another device).

const admin = adminClient();

async function insertBell(userId: string, over: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await admin
    .from('notifications')
    .insert({
      user_id: userId,
      type: 'comment',
      title: 'QA clear test',
      message: `QA clear ${Date.now()}`,
      action_url: '/feed?clear-e2e=1',
      is_read: false,
      ...over,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

async function isRead(id: string): Promise<boolean> {
  const { data } = await admin.from('notifications').select('is_read').eq('id', id).single();
  return data?.is_read === true;
}

const bell = (page: Page) => page.getByRole('button', { name: /^Notifications/ }).first();

/** Other specs leave this user rows; the exact count is theirs, the suffix is ours. */
const unreadLabel = /^Notifications, \d+ unread$/;

test('opening the bell marks everything read: the dot goes, the rows stay "new" for that open @mobile', async ({ page }) => {
  const user = loadQaUser('user.json');
  const ids = [await insertBell(user.id), await insertBell(user.id)];
  try {
    await page.goto('/feed');
    await expect(bell(page)).toHaveAttribute('aria-label', unreadLabel, { timeout: 20_000 });
    await bell(page).click();
    // Read, server and client: the label loses its count, the rows read.
    await expect(bell(page)).toHaveAttribute('aria-label', 'Notifications', { timeout: 15_000 });
    await expect.poll(async () => (await Promise.all(ids.map(isRead))).every(Boolean), { timeout: 15_000 }).toBe(true);
    // Still "new" for this open.
    const panelNew = page.locator('[data-notifications-new]');
    await expect(panelNew).toBeVisible();
    expect(Number(await panelNew.getAttribute('data-notifications-new'))).toBeGreaterThanOrEqual(2);
    for (const id of ids) {
      await expect(page.locator(`[data-notification-id="${id}"][data-notification-fresh]`)).toHaveCount(1);
    }
    // A pending fan request keeps Accept / Decline — read is not decided.
    await expect(page.getByRole('button', { name: 'Mark all read' })).toHaveCount(0);
  } finally {
    await admin.from('notifications').delete().in('id', ids);
  }
});

test('opening the Notifications screen marks everything read; there is no Unread tab @mobile', async ({ page }) => {
  const user = loadQaUser('user.json');
  const id = await insertBell(user.id);
  try {
    await page.goto('/app/notifications');
    await expect(page.locator(`[data-notification-card="${id}"]`)).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => isRead(id), { timeout: 15_000 }).toBe(true);
    await expect(page.locator(`[data-notification-card="${id}"][data-notification-fresh]`)).toHaveCount(1);
    expect(Number(await page.locator('p[data-notifications-new]').getAttribute('data-notifications-new'))).toBeGreaterThanOrEqual(1);
    await expect(page.getByRole('button', { name: 'Unread' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mark all read' })).toHaveCount(0);
    await expect(bell(page)).toHaveAttribute('aria-label', 'Notifications', { timeout: 15_000 });
  } finally {
    await admin.from('notifications').delete().eq('id', id);
  }
});

test('reading a conversation clears its message bells', async ({ page }) => {
  const user = loadQaUser('user.json');
  const other = loadQaUser('user-b.json');
  const { data: convo, error } = await admin
    .from('conversations')
    .insert({ type: 'direct', created_by: other.id })
    .select('id')
    .single();
  if (error) throw error;
  const conversationId = convo.id as string;
  let bellId: string | null = null;
  try {
    const { error: pError } = await admin.from('conversation_participants').insert([
      { conversation_id: conversationId, profile_id: user.id },
      { conversation_id: conversationId, profile_id: other.id },
    ]);
    if (pError) throw pError;
    bellId = await insertBell(user.id, {
      type: 'new_message',
      actor_id: other.id,
      title: 'Edge Bravo sent you a message',
      message: 'QA clear message',
      action_url: `/messages?c=${conversationId}`,
      metadata: { conversation_id: conversationId, message_id: null },
    });
    await page.goto('/feed');
    await expect(bell(page)).toHaveAttribute('aria-label', unreadLabel, { timeout: 20_000 });
    const before = Number((await bell(page).getAttribute('aria-label'))!.match(/\d+/)![0]);

    // The messages client marks a conversation read with this PATCH.
    const res = await page.request.patch(`/api/messages/${conversationId}/read`);
    expect(res.ok()).toBe(true);
    expect((await res.json()).notifications_read).toBe(1);
    await expect.poll(() => isRead(bellId!), { timeout: 10_000 }).toBe(true);

    // The open tab learns of it the way a returning phone does — a return to
    // the foreground re-reads (the request above went around the provider).
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(bell(page)).toHaveAttribute(
      'aria-label',
      before - 1 > 0 ? `Notifications, ${before - 1} unread` : 'Notifications',
      { timeout: 15_000 }
    );
  } finally {
    if (bellId) await admin.from('notifications').delete().eq('id', bellId);
    await admin.from('conversations').delete().eq('id', conversationId);
  }
});

test('a decided fan request is a read bell', async ({ page }) => {
  const user = loadQaUser('user.json');
  const other = loadQaUser('user-b.json');
  // B asks to become A's fan: the trigger writes A's follow_request bell.
  await admin.from('follows').delete().eq('follower_id', other.id).eq('following_id', user.id);
  const { data: follow, error } = await admin
    .from('follows')
    .insert({ follower_id: other.id, following_id: user.id, status: 'pending' })
    .select('id')
    .single();
  if (error) throw error;
  const followId = follow.id as string;
  try {
    const bellRow = async () => {
      const { data } = await admin
        .from('notifications')
        .select('id, is_read, action_status')
        .eq('follow_id', followId)
        .eq('type', 'follow_request')
        .maybeSingle();
      return data as { id: string; is_read: boolean; action_status: string | null } | null;
    };
    await expect.poll(async () => (await bellRow())?.id ?? null, { timeout: 10_000 }).not.toBeNull();
    const row = (await bellRow())!;
    expect(row.is_read).toBe(false);

    // The server half, without the bell's own open: the decision stamps read.
    const res = await page.request.post(`/api/notifications/${row.id}/action`, { data: { action: 'accept' } });
    expect(res.ok()).toBe(true);
    await expect.poll(async () => {
      const after = await bellRow();
      return after ? `${after.action_status}/${after.is_read}` : 'gone';
    }, { timeout: 10_000 }).toBe('accepted/true');
  } finally {
    await admin.from('notifications').delete().eq('follow_id', followId);
    await admin.from('follows').delete().eq('id', followId);
  }
});

test('a read done elsewhere is seen when the app returns to the foreground', async ({ page }) => {
  const user = loadQaUser('user.json');
  const id = await insertBell(user.id);
  try {
    await page.goto('/feed');
    await expect(bell(page)).toHaveAttribute('aria-label', unreadLabel, { timeout: 20_000 });
    const before = Number((await bell(page).getAttribute('aria-label'))!.match(/\d+/)![0]);
    // As the worker does when a phone notification is tapped.
    await admin.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('id', id);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(bell(page)).toHaveAttribute(
      'aria-label',
      before - 1 > 0 ? `Notifications, ${before - 1} unread` : 'Notifications',
      { timeout: 15_000 }
    );
  } finally {
    await admin.from('notifications').delete().eq('id', id);
  }
});
