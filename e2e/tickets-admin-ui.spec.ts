import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Support & Reporting, Spec 1 PR 4 — the admin UI in a real browser. Alpha
// files a ticket over the API; bravo (a MODERATOR row through the service
// key) opens /dashboard/tickets, sees the row and the counts, opens the
// ticket, takes it into review, sends a reply, adds an internal note and
// resolves it through the form + the confirm — then alpha's API view shows
// the outcome and never the note. The header shows bravo "Support queue"
// and NOT "Admin dashboard". Self-skips pre-222. @mobile (390×844 and
// WebKit): the queue is one column and every control is reachable.

test('support queue UI: the row, the detail, take · reply · note · resolve, the header entry @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const bravo = loadQaUser('user-b.json');
  const probe = await admin.from('tickets').select('id').limit(1);
  test.skip(!!probe.error, `tickets missing — run migration 222 (${probe.error?.message})`);

  const alphaApi = await apiAs('state.json');
  await resetRateBucket(admin, 'ticket-create', alpha.id);
  const ticketIds: string[] = [];
  const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
  try {
    let res = await alphaApi.post('/api/tickets', { data: { type: 'help', reason: 'events', subject: 'Cannot join the Sunday event', description: 'The Join button is greyed out for me.' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const created = (await res.json()) as { id: string; number: string };
    ticketIds.push(created.id);

    const { error: roleError } = await admin.from('platform_admins').upsert({ profile_id: bravo.id, role: 'moderator' }, { onConflict: 'profile_id' });
    expect(roleError).toBeNull();

    const page = await ctxB.newPage();
    await page.goto('/dashboard/tickets');
    await expect(page.getByRole('heading', { name: 'Support queue' })).toBeVisible();
    const row = page.locator(`[data-ticket-row="${created.id}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(created.number);
    await expect(row).toContainText('Cannot join the Sunday event');
    await expect(page.getByLabel('Open counts')).toContainText('Open');

    // The header: a moderator gets the queue entry, never the dashboard.
    // The drawer below lg, the account dropdown from lg up — open whichever is on screen.
    const drawerToggle = page.getByRole('button', { name: 'Toggle mobile menu' });
    if (await drawerToggle.isVisible()) await drawerToggle.click();
    else await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.locator('[data-support-queue-link]').first()).toBeVisible();
    await expect(page.locator('[data-admin-dashboard-link]')).toHaveCount(0);
    if (await drawerToggle.isVisible()) await page.getByRole('button', { name: 'Close menu' }).click();
    else await page.keyboard.press('Escape');

    // The detail.
    await row.click();
    await expect(page.locator('[data-ticket-number]')).toHaveText(created.number);
    await expect(page.locator('[data-ticket-status="new"]').first()).toBeVisible();
    await page.locator('[data-ticket-take]').click();
    await expect(page.locator('[data-ticket-status="in_review"]').first()).toBeVisible();

    await page.locator('[data-ticket-reply-box]').fill('Which event is it? Send me the link.');
    await page.locator('[data-ticket-send-reply]').click();
    await expect(page.locator('[data-ticket-status="waiting_on_user"]').first()).toBeVisible();
    await expect(page.locator('[data-ticket-history]')).toContainText('Which event is it?');

    await page.locator('[data-ticket-note-box]').fill('Probably the capacity cap.');
    await page.locator('[data-ticket-add-note]').click();
    await expect(page.locator('[data-ticket-history]')).toContainText('Probably the capacity cap.');

    await page.locator('[data-ticket-resolve-toggle]').click();
    const form = page.locator('[data-ticket-resolve-form]');
    await form.getByLabel('Resolution').selectOption('no_action');
    await form.getByLabel(/What we decided/).fill('The event was full; the organizer raised the cap.');
    await page.locator('[data-ticket-resolve]').click();
    await page.getByRole('button', { name: 'Resolve', exact: true }).click();
    await expect(page.locator('[data-ticket-status="resolved"]').first()).toBeVisible();
    await expect(page.getByText('No action needed')).toBeVisible();

    // Alpha's view: the outcome, the reply, never the note.
    res = await alphaApi.get(`/api/tickets/${created.id}`);
    const view = (await res.json()) as { ticket: { status: string; resolution_note: string | null }; events: Array<{ body: string | null }> };
    expect(view.ticket.status).toBe('resolved');
    expect(view.ticket.resolution_note).toBe('The event was full; the organizer raised the cap.');
    expect(JSON.stringify(view)).not.toContain('capacity cap');
    expect(view.events.some(e => e.body === 'Which event is it? Send me the link.')).toBe(true);
  } finally {
    await ctxB.close();
    if (ticketIds.length > 0) await admin.from('tickets').delete().in('id', ticketIds);
    await admin.from('platform_admins').delete().eq('profile_id', bravo.id);
    await admin.from('notifications').delete().in('type', ['ticket_update', 'ticket_critical']).in('user_id', [alpha.id, bravo.id]);
  }
});
