import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

/**
 * Events program, phase 2b (B2, mig 210) — the day-before reminder bell
 * renders. The sender runs from the daily cron (CRON_SECRET-gated, not
 * callable here; its planner is unit-tested), so this spec inserts a
 * `sport_event_reminder` row for A the way the sender does and asserts the
 * notifications page shows it with its copy. Self-skips before 210 ran
 * (the CHECK refuses the type — the sender tolerates the same).
 */
test('notifications: a sport_event_reminder bell renders with its copy', async ({ page }) => {
  const userA = loadQaUser('user.json');
  const admin = adminClient();
  const stamp = Date.now();
  const title = `Tomorrow: QA Reminder ${stamp}`;
  const { data: inserted, error } = await admin.from('notifications').insert({
    user_id: userA.id,
    type: 'sport_event_reminder',
    actor_id: null,
    title,
    message: 'Sat, Jun 1, 2030 · QA Reminder Links',
    action_url: '/sports/events?tab=schedule',
    is_read: false,
    metadata: { sport_event_id: '00000000-0000-4000-8000-000000000000', sport_event_round_id: `qa-${stamp}`, sport_event_name: `QA Reminder ${stamp}` },
  }).select('id').single();
  test.skip(!!error && (error as { code?: string }).code === '23514', 'sport_event_reminder not in the type CHECK — run migration 210');
  expect(error, error?.message).toBeNull();
  try {
    await page.goto('/app/notifications');
    const card = page.locator('[data-notification-card][data-notification-type="sport_event_reminder"]').filter({ hasText: title }).first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText('QA Reminder Links');
  } finally {
    if (inserted?.id) await admin.from('notifications').delete().eq('id', inserted.id);
  }
});
