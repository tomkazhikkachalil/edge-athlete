import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Support & Reporting, Spec 4 — suggestions and the polish, over the API and
// in the browser at 390×844. Alpha sends an idea from /help (Low severity,
// contact_ok); bravo sends a near-duplicate over the API; delta (a
// moderator) opens bravo's on the ticket page and MERGES it into alpha's
// by number (the count moves, bravo keeps theirs, the queue lists one), tags
// alpha's "planned", pastes an emailed reply from alpha onto it (it lands as
// alpha's reply), and resolves it "feature shipped" — alpha AND bravo (the
// merged reporter) get the shipped bell. The queue's stats line renders.
// Self-skips pre-222. @mobile.

test('suggestions: the form, the admin merge, the pasted reply, the tag, feature shipped reaches the merged reporter, the stats line @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const bravo = loadQaUser('user-b.json');
  const delta = loadQaUser('user-d.json');
  const probe = await admin.from('tickets').select('id').limit(1);
  test.skip(!!probe.error, `tickets missing — run migration 222 (${probe.error?.message})`);

  const bravoApi = await apiAs('state-b.json');
  const deltaApi = await apiAs('state-d.json');
  await resetRateBucket(admin, 'ticket-create', alpha.id);
  await resetRateBucket(admin, 'ticket-create', bravo.id);
  const rand = Math.random().toString(36).slice(2, 8);
  const ticketIds: string[] = [];
  const ctxA = await browser.newContext({ storageState: 'e2e/.auth/state.json' });
  const ctxD = await browser.newContext({ storageState: 'e2e/.auth/state-d.json' });
  try {
    await admin.from('platform_admins').upsert({ profile_id: delta.id, role: 'moderator' }, { onConflict: 'profile_id' });

    // Alpha: the form on /help.
    const pageA = await ctxA.newPage();
    await pageA.goto('/help#suggest');
    const form = pageA.locator('[data-suggest-form]');
    await expect(form).toBeVisible();
    await form.getByLabel('Where does it belong?').selectOption('stats');
    await form.locator('[data-suggest-title]').fill(`Season averages on the profile ${rand}`);
    await form.locator('[data-suggest-description]').fill('Show my season averages, not only the game log.');
    await form.locator('[data-suggest-submit]').click();
    const created = form.locator('[data-suggest-created]');
    await expect(created).toBeVisible();
    const numberA = (await created.getAttribute('data-suggest-created')) ?? '';
    expect(numberA).toMatch(/^EA-\d{4,}$/);
    const { data: rowA } = await admin.from('tickets').select('id, type, severity, reason, contact_ok, number').eq('reporter_profile_id', alpha.id).eq('subject', `Season averages on the profile ${rand}`).single();
    ticketIds.push(rowA!.id as string);
    expect(rowA).toMatchObject({ type: 'suggestion', severity: 'low', reason: 'stats', contact_ok: true });

    // Bravo: a near-duplicate over the API, follow-up mail off.
    let res = await bravoApi.post('/api/tickets', { data: { type: 'suggestion', reason: 'stats', subject: `Averages please ${rand}`, description: 'Same idea.', contact_ok: false } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const rowB = (await res.json()) as { id: string; number: string };
    ticketIds.push(rowB.id);

    // Delta: merge bravo's into alpha's by number, from the ticket page.
    const pageD = await ctxD.newPage();
    await pageD.goto(`/dashboard/tickets/${rowB.id}`);
    await pageD.locator('[data-ticket-merge-into]').fill(numberA);
    await pageD.locator('[data-ticket-merge]').click();
    await expect(pageD.locator('[data-ticket-merged]')).toBeVisible();
    const { data: merged } = await admin.from('tickets').select('merged_into_id, status').eq('id', rowB.id).single();
    expect(merged).toMatchObject({ merged_into_id: rowA!.id, status: 'closed' });
    const { data: target } = await admin.from('tickets').select('report_count').eq('id', rowA!.id).single();
    expect(target!.report_count).toBe(2);
    // Bravo still sees theirs; the queue lists alpha's only.
    res = await bravoApi.get('/api/tickets');
    expect(((await res.json()).tickets as Array<{ id: string }>).map(t => t.id)).toContain(rowB.id);
    res = await deltaApi.get('/api/admin/tickets?status=all&type=suggestion');
    const ids = ((await res.json()).tickets as Array<{ id: string }>).map(t => t.id);
    expect(ids).toContain(rowA!.id);
    expect(ids).not.toContain(rowB.id);
    // The merge refuses nonsense.
    expect((await deltaApi.post(`/api/admin/tickets/${rowA!.id}/merge`, { data: { into: numberA } })).status()).toBe(409);
    expect((await deltaApi.post(`/api/admin/tickets/${rowA!.id}/merge`, { data: { into: 'EA-1' } })).status()).toBe(404);

    // The tag, the pasted reply, the stats line.
    await pageD.goto(`/dashboard/tickets/${rowA!.id}`);
    await pageD.getByLabel('Review tag').selectOption('planned');
    await expect(pageD.getByLabel('Review tag')).toHaveValue('planned');
    await pageD.locator('[data-ticket-paste-box]').fill('(from email) Yes — per sport, please.');
    await pageD.locator('[data-ticket-paste]').click();
    await expect(pageD.locator('[data-ticket-history]')).toContainText('(from email) Yes — per sport, please.');
    await expect(pageD.locator('[data-ticket-history]')).toContainText('Reply from the user');
    await pageD.goto('/dashboard/tickets');
    await expect(pageD.locator('[data-ticket-stats]')).toContainText('Last 90 days');

    // Feature shipped → alpha's bell and bravo's (the merged reporter) too.
    res = await deltaApi.patch(`/api/admin/tickets/${rowA!.id}`, { data: { status: 'resolved', resolution_code: 'feature_shipped', resolution_note: 'Season averages are on the Stats tab now.' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    for (const uid of [alpha.id, bravo.id]) {
      const { data: bells } = await admin.from('notifications').select('title').eq('user_id', uid).eq('type', 'ticket_update');
      expect((bells ?? []).some(b => /live|resolved/i.test(b.title as string)), uid).toBe(true);
    }
    const { data: dupAfter } = await admin.from('tickets').select('resolution_code').eq('id', rowB.id).single();
    expect(dupAfter!.resolution_code).toBe('feature_shipped');
    // Alpha's view says so.
    await pageA.goto(`/settings?tab=support&ticket=${rowA!.id}`);
    await expect(pageA.locator(`[data-my-request="${rowA!.id}"] [data-request-thread]`)).toContainText('Season averages are on the Stats tab now.');
  } finally {
    for (const c of [ctxA, ctxD]) await c.close().catch(() => null);
    if (ticketIds.length > 0) await admin.from('tickets').delete().in('id', ticketIds);
    await admin.from('platform_admins').delete().eq('profile_id', delta.id);
    await admin.from('notifications').delete().in('type', ['ticket_update', 'ticket_critical']).in('user_id', [alpha.id, bravo.id, delta.id]);
  }
});
