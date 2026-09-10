import { test, expect } from '@playwright/test';
import {
  adminClient, adminEmailForE2E, createQaUser, deleteQaUser, mintStorageState, readErrorBody,
} from './helpers/qa-user';

// The admin-positive half of the site-metrics story (Site Builder backlog B6
// left it "owed": the metrics route gates on ADMIN_EMAILS, a server env no
// random QA address can join). With E2E_ADMIN_EMAIL set to an address the
// target build lists in ADMIN_EMAILS — and that no real account owns — this
// spec creates a disposable user with exactly that address, mints its
// session, reads the route and the dashboard panel, then deletes the user.
// Unset → skipped with the reason; the negative half (an org owner is
// refused) stays in org-site-start.spec.ts.

const adminEmail = adminEmailForE2E();

test.describe('admin site metrics (admin-positive)', () => {
  test.skip(!adminEmail, 'E2E_ADMIN_EMAIL unset — set it to an address in the target build\'s ADMIN_EMAILS');

  test('the metrics route answers an admin and the dashboard panel renders the numbers', async ({ browser }) => {
    const admin = adminClient();
    // A crashed earlier run can leave the address behind — the sweep only
    // reaches it after 24h, so reclaim it now.
    const { data: leftover } = await admin.from('profiles').select('id').eq('email', adminEmail!).maybeSingle();
    if (leftover?.id) await deleteQaUser(leftover.id);

    const user = await createQaUser({ email: adminEmail!, displayName: 'Edge QA Admin', firstName: 'Edge', lastName: 'Admin' });
    try {
      const storageState = await mintStorageState(user);
      const ctx = await browser.newContext({ storageState, viewport: { width: 1280, height: 900 } });
      try {
        // The route: 200 for an admin (403 for everyone else — the owner half).
        const res = await ctx.request.get('/api/admin/site-metrics');
        expect(res.status(), await readErrorBody(res)).toBe(200);
        const body = (await res.json()) as { supported: boolean; metrics?: Record<string, unknown> };
        expect(typeof body.supported).toBe('boolean');
        test.skip(!body.supported, 'org_site_revisions missing — run migration 180');
        const m = body.metrics as {
          sites: { total: number; live: number };
          publishes: { total: number };
          firstPublish: { count: number; withinHour: number };
          editor: { adoptionRate: number | null };
          truncated: boolean;
        };
        expect(m.sites.total).toBeGreaterThanOrEqual(m.sites.live);
        expect(m.publishes.total).toBeGreaterThanOrEqual(0);
        expect(m.firstPublish.count).toBeGreaterThanOrEqual(m.firstPublish.withinHour);
        if (m.editor.adoptionRate !== null) {
          expect(m.editor.adoptionRate).toBeGreaterThanOrEqual(0);
          expect(m.editor.adoptionRate).toBeLessThanOrEqual(1);
        }
        expect(typeof m.truncated).toBe('boolean');

        // The panel: the real tiles, not the loading or the pre-180 copy.
        const page = await ctx.newPage();
        await page.goto('/dashboard');
        const panel = page.locator('[data-admin-site-metrics]');
        await expect(panel).toBeVisible({ timeout: 30_000 });
        await expect(panel).not.toContainText('Loading…', { timeout: 30_000 });
        await expect(panel).not.toContainText('need a database migration first');
        await expect(panel).toContainText(String(m.sites.total));
        await expect(panel.getByRole('button', { name: /Storage sweep/ })).toBeVisible();
      } finally {
        await ctx.close();
      }
    } finally {
      await deleteQaUser(user.id);
    }
  });
});
