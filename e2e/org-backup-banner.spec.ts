import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';
import { createQaOrg, deleteQaOrgs } from './helpers/org';

// ── Authority PR 2 (Sep 25 2026): the org's backup warning ──────────────────
// Tom: a co-owner OR a manager is the backup (staff do not count); a warning,
// never a block. The owner's console shows the banner until a second active
// owner or manager exists; its one action opens the members list.

test('the org console warns its lone owner until a manager is named @mobile', async ({ browser }) => {
  test.setTimeout(90_000);
  const admin = adminClient();
  const stamp = Date.now();
  const owner = loadQaUser('user-b.json');
  const second = loadQaUser('user.json');
  const club = await createQaOrg(admin, 'club', { name: `QA Backup Club ${stamp}`, owner_profile_id: owner.id });
  const member = (profileId: string, role: string) => ({ org_id: club.id, profile_id: profileId, kind: 'follow', role, status: 'active', scope_type: 'org', scope_id: null });
  try {
    expect((await admin.from('memberships').insert([member(owner.id, 'owner'), member(second.id, 'member')])).error).toBeNull();
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 390, height: 844 } });
    try {
      const page = await ctx.newPage();
      await page.goto(`/app/org/club/${club.id}`);
      const banner = page.locator('[data-backup-banner="none"][data-backup-subject="org"]');
      await expect(banner).toBeVisible({ timeout: 20_000 });
      await expect(banner.locator('[data-backup-act]')).toHaveAttribute('href', `/club/${club.id}?window=members`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

      // A manager is a backup: the banner goes.
      expect((await admin.from('memberships').update({ role: 'manager' }).eq('org_id', club.id).eq('profile_id', second.id).eq('kind', 'follow')).error).toBeNull();
      await page.reload();
      await expect(page.locator('[data-backup-subject="org"]')).toHaveCount(0, { timeout: 20_000 });
    } finally {
      await ctx.close();
    }
  } finally {
    await deleteQaOrgs(admin, [club.id]);
  }
});
