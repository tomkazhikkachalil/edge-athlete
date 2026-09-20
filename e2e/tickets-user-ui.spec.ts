import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Support & Reporting, Spec 1 PR 5 — the user's front door in a real
// browser at 390×844. Alpha opens Settings → Support (the ?tab= deep link),
// submits a Help request through the form and sees the ticket number; the
// row appears under My requests; bravo (a moderator row through the service
// key) replies over the API; alpha follows the bell's deep link
// (?ticket=<id>) — the row is expanded with Support's reply — answers from
// the box, and after the API resolves it sees the outcome and the one-appeal
// wording. Self-skips pre-222. @mobile.

test('support settings: submit a request, My requests, the deep link, reply, the outcome @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const bravo = loadQaUser('user-b.json');
  const probe = await admin.from('tickets').select('id').limit(1);
  test.skip(!!probe.error, `tickets missing — run migration 222 (${probe.error?.message})`);

  const bravoApi = await apiAs('state-b.json');
  await resetRateBucket(admin, 'ticket-create', alpha.id);
  await resetRateBucket(admin, 'ticket-reply', alpha.id);
  const ctxA = await browser.newContext({ storageState: 'e2e/.auth/state.json' });
  let ticketId: string | null = null;
  try {
    const { error: roleError } = await admin.from('platform_admins').upsert({ profile_id: bravo.id, role: 'moderator' }, { onConflict: 'profile_id' });
    expect(roleError).toBeNull();

    const page = await ctxA.newPage();
    await page.goto('/settings?tab=support');
    await expect(page.getByRole('heading', { name: 'Submit a request' })).toBeVisible();
    await page.getByLabel('What is it about?').selectOption('events');
    await page.getByLabel(/^Subject/).fill('Sunday event will not let me join');
    await page.getByLabel('What happened?').fill('The Join button is greyed out on my phone.');
    await page.locator('[data-support-submit]').click();
    const created = page.locator('[data-support-created]');
    await expect(created).toBeVisible();
    const number = (await created.getAttribute('data-support-created')) ?? '';
    expect(number).toMatch(/^EA-\d{4,}$/);

    // The row under My requests, then the id from the database.
    const row = page.locator('[data-my-request]').filter({ hasText: number });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Sunday event will not let me join');
    ticketId = (await row.getAttribute('data-my-request')) ?? null;
    expect(ticketId).toBeTruthy();

    // Support replies over the API.
    let res = await bravoApi.post(`/api/admin/tickets/${ticketId}/reply`, { data: { body: 'Which event is it? Send me the link.' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // The bell's deep link opens the thread with the reply; alpha answers from the box.
    await page.goto(`/settings?tab=support&ticket=${ticketId}`);
    const thread = page.locator(`[data-my-request="${ticketId}"] [data-request-thread]`);
    await expect(thread).toBeVisible();
    await expect(thread).toContainText('Which event is it?');
    await expect(thread).toContainText('Support');
    await thread.locator('[data-request-reply-box]').fill('The Sunday scramble at Oak Ridge.');
    await thread.locator('[data-request-send]').click();
    await expect(thread).toContainText('The Sunday scramble at Oak Ridge.');
    await expect(page.locator(`[data-my-request="${ticketId}"] [data-ticket-status="in_review"]`)).toBeVisible();

    // Resolved over the API → the outcome and the one-appeal wording.
    res = await bravoApi.patch(`/api/admin/tickets/${ticketId}`, { data: { status: 'resolved', resolution_code: 'no_action', resolution_note: 'The event was full; the cap was raised.' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    await page.goto(`/settings?tab=support&ticket=${ticketId}`);
    await expect(thread).toContainText('The event was full; the cap was raised.');
    await expect(thread).toContainText('Reply once');
    await expect(thread.locator('[data-request-send]')).toHaveText('Send appeal');
  } finally {
    await ctxA.close();
    if (ticketId) await admin.from('tickets').delete().eq('id', ticketId);
    await admin.from('platform_admins').delete().eq('profile_id', bravo.id);
    await admin.from('notifications').delete().in('type', ['ticket_update', 'ticket_critical']).in('user_id', [alpha.id, bravo.id]);
  }
});
