import { test, expect } from './helpers/test';
import { adminClient, adminEmailForE2E, createQaUser, deleteQaUser, mintStorageState, readErrorBody } from './helpers/qa-user';

// The contact list in the console (flow changes item 1 — A3, Oct 19 2026,
// migration 266), admin-positive: with E2E_ADMIN_EMAIL set to an address
// the target build lists in ADMIN_EMAILS (and no real account owns), this
// spec seeds three rows, reads the list with its filters, downloads both
// CSVs (the marketing one dedupes and keeps only the consented), sets the
// notify inbox and clears it, and sees the page render. Unset → skipped
// with the reason. The owner-only half (a stranger is refused) rides here
// too through a plain QA user. Self-skips pre-266.

const adminEmail = adminEmailForE2E();
const stamp = Date.now().toString(36);

test.describe('admin contacts (admin-positive)', () => {
  test.skip(!adminEmail, 'E2E_ADMIN_EMAIL unset — set it to an address in the target build\'s ADMIN_EMAILS');

  test('the list, the two exports, the inbox setting, the page @mobile', async ({ browser }) => {
    test.setTimeout(180_000);
    const admin = adminClient();
    const probe = await admin.from('contacts').select('id').limit(1);
    test.skip(!!probe.error, `contacts missing — run migration 266 (${probe.error?.message})`);
    const { data: leftover } = await admin.from('profiles').select('id').eq('email', adminEmail!).maybeSingle();
    if (leftover?.id) await deleteQaUser(leftover.id);

    const emails = [`edgeqa-ac-a-${stamp}@example.com`, `edgeqa-ac-b-${stamp}@example.com`];
    const consentText = 'Also send me Edge Athlete news and offers';
    // Seed: A signed up and agreed, then sent an inquiry (no box) — still agreed; B signed up and did not agree.
    const t0 = Date.parse('2026-01-01T00:00:00Z');
    const { error: seedErr } = await admin.from('contacts').insert([
      { email: emails[0], name: 'Alpha Agreed', source: 'notify_signup', marketing_consent: true, consent_text: consentText, created_at: new Date(t0).toISOString() },
      { email: emails[0], name: null, source: 'inquiry', message: `Is there a league near me? ${stamp}`, marketing_consent: false, consent_text: null, created_at: new Date(t0 + 1000).toISOString() },
      { email: emails[1], name: 'Bravo Declined', source: 'notify_signup', marketing_consent: false, consent_text: consentText, created_at: new Date(t0 + 2000).toISOString() },
    ]);
    expect(seedErr).toBeNull();

    const owner = await createQaUser({ email: adminEmail!, displayName: 'Edge QA Admin', firstName: 'Edge', lastName: 'Admin' });
    const stranger = await createQaUser({ displayName: 'Plain Pat', firstName: 'Plain', lastName: 'Pat' });
    const ownerCtx = await browser.newContext({ storageState: await mintStorageState(owner) });
    const strangerCtx = await browser.newContext({ storageState: await mintStorageState(stranger) });
    try {
      // A stranger is refused everywhere.
      for (const path of ['/api/admin/contacts', '/api/admin/contacts/export', '/api/admin/settings']) {
        expect((await strangerCtx.request.get(path)).status(), path).toBe(403);
      }

      // The list, filtered to this run's rows.
      let res = await ownerCtx.request.get(`/api/admin/contacts?q=edgeqa-ac-&page=1`);
      expect(res.status(), await readErrorBody(res)).toBe(200);
      let body = (await res.json()) as { supported: boolean; total: number; rows: { email: string; source: string }[]; counts: { all: number } };
      expect(body.supported).toBe(true);
      expect(body.total).toBe(3);
      expect(body.rows[0].source).toBe('notify_signup'); // newest first: B
      expect(body.counts.all).toBeGreaterThanOrEqual(3);
      res = await ownerCtx.request.get(`/api/admin/contacts?q=edgeqa-ac-&source=inquiry`);
      body = await res.json();
      expect(body.total).toBe(1);
      res = await ownerCtx.request.get(`/api/admin/contacts?q=edgeqa-ac-&consent=1`);
      body = await res.json();
      expect(body.total).toBe(1);

      // The exports: every submission vs the consented, one per email.
      res = await ownerCtx.request.get('/api/admin/contacts/export?list=all');
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toContain('text/csv');
      expect(res.headers()['content-disposition']).toMatch(/attachment; filename="contacts-\d{4}-\d{2}-\d{2}\.csv"/);
      const all = await res.text();
      expect(all.split('\r\n')[0]).toBe('date,name,email,source,user_type,marketing_consent,message');
      expect(all.split(emails[0]).length - 1).toBe(2);
      expect(all).toContain(emails[1]);
      res = await ownerCtx.request.get('/api/admin/contacts/export?list=marketing');
      const marketing = await res.text();
      expect(res.headers()['content-disposition']).toContain('contacts-marketing-');
      expect(marketing.split(emails[0]).length - 1).toBe(1);
      expect(marketing).not.toContain(emails[1]);
      // The deduped row keeps the latest facts: the inquiry's message beside the earlier name.
      const line = marketing.split('\r\n').find(l => l.includes(emails[0]))!;
      expect(line).toContain('Alpha Agreed');
      expect(line).toContain('Is there a league near me?');

      // The inbox setting: set, read back as the source, clear.
      res = await ownerCtx.request.get('/api/admin/settings');
      expect(res.status()).toBe(200);
      const before = (await res.json()) as { notifyInbox: { value: string | null; source: string } };
      res = await ownerCtx.request.put('/api/admin/settings', { data: { key: 'notify_inbox_email', value: `inbox-${stamp}@example.com` } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      expect((await res.json()).notifyInbox).toEqual({ value: `inbox-${stamp}@example.com`, source: 'setting' });
      res = await ownerCtx.request.put('/api/admin/settings', { data: { key: 'something_else', value: 'x' } });
      expect(res.status()).toBe(400);
      // The test mail answers honestly whatever the deployment's SMTP state.
      res = await ownerCtx.request.post('/api/admin/contacts/test-mail', { data: {} });
      expect(res.status()).toBe(200);
      const mail = (await res.json()) as { sent: boolean; reason: string | null };
      expect(typeof mail.sent).toBe('boolean');
      if (!mail.sent) expect(['smtp_unset', 'no_address', 'provider_refused']).toContain(mail.reason);
      res = await ownerCtx.request.put('/api/admin/settings', { data: { key: 'notify_inbox_email', value: null } });
      expect((await res.json()).notifyInbox.source).toBe(before.notifyInbox.source === 'setting' ? 'env' : before.notifyInbox.source);

      // The page: the card, the list with this run's rows, the message opening, the tile on the console.
      const page = await ownerCtx.newPage();
      await page.goto('/dashboard');
      const tile = page.locator('[data-contacts-tile]');
      await expect(tile).toBeVisible({ timeout: 30_000 });
      await expect(tile).toContainText('sign-ups', { timeout: 30_000 });
      await tile.click();
      await expect(page).toHaveURL(/\/dashboard\/contacts$/);
      await expect(page.locator('[data-notify-inbox-card]')).toBeVisible({ timeout: 30_000 });
      await page.locator('[data-contacts-search]').fill('edgeqa-ac-');
      await expect(page.locator('[data-contacts-total="3"]')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-contact-row]')).toHaveCount(3);
      await page.locator('[data-contact-message="preview"]').first().click();
      await expect(page.locator('[data-contact-message="open"]')).toContainText('Is there a league near me?');
      if (process.env.E2E_DUMP_DIR) await page.screenshot({ path: `${process.env.E2E_DUMP_DIR}/admin-contacts-${test.info().project.name}.png`, fullPage: true });
      await page.locator('[data-contacts-filter-source]').selectOption('inquiry');
      await expect(page.locator('[data-contact-row]')).toHaveCount(1);
      await expect(page.locator('[data-contacts-export="marketing"]')).toHaveAttribute('href', '/api/admin/contacts/export?list=marketing');
    } finally {
      await ownerCtx.close();
      await strangerCtx.close();
      await admin.from('contacts').delete().in('email', emails);
      await admin.from('app_settings').delete().eq('key', 'notify_inbox_email').like('value', `inbox-${stamp}%`);
      await deleteQaUser(stranger.id);
      await deleteQaUser(owner.id);
    }
  });
});
