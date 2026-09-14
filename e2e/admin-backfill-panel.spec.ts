import { test, expect } from '@playwright/test';
import { adminClient, adminEmailForE2E, apiAs, createQaUser, deleteQaUser, mintStorageState, readErrorBody } from './helpers/qa-user';

// Data foundation F5b: the backfill's door on the admin dashboard. An admin
// session sees the panel; "Dry run all" reaches the four sources in order
// with counts and writes nothing; "Run for real" (behind the confirm)
// restores a stat line's hand-deleted row. Skips without E2E_ADMIN_EMAIL;
// the live half skips pre-194.
const adminEmail = adminEmailForE2E();

test('admin dashboard: the performance backfill panel dry-runs all four sources and runs for real behind the confirm', async ({ browser }) => {
  test.skip(!adminEmail, 'E2E_ADMIN_EMAIL unset — set it to an address in the target build\'s ADMIN_EMAILS');
  test.setTimeout(180_000);
  const admin = adminClient();
  const qa = await apiAs('state.json');
  const adminUser = await createQaUser({ email: adminEmail!, displayName: 'Edge QA Admin', firstName: 'Edge', lastName: 'Admin' });
  const ctx = await browser.newContext({ storageState: await mintStorageState(adminUser) });
  let postId = '';
  try {
    const page = await ctx.newPage();
    await page.goto('/dashboard');
    const panel = page.locator('[data-admin-performance-backfill]');
    await expect(panel).toBeVisible({ timeout: 20_000 });

    await panel.locator('[data-backfill-dry]').click();
    for (const source of ['golf_rounds', 'posts', 'contest_stat_lines', 'contest_results']) {
      await expect(panel.locator(`[data-backfill-source="${source}"]`)).toHaveAttribute('data-backfill-status', 'done', { timeout: 60_000 });
    }
    await expect(panel.locator('[data-backfill-source="posts"]')).toContainText('dry run — nothing written');

    const probe = await admin.from('athlete_performances').select('id').limit(1);
    test.skip(!!probe.error && (probe.error.code === '42P01' || probe.error.code === 'PGRST205'), 'migration 194 not applied on this target');

    // Seed a stat line, remove its row by hand, then run for real.
    const post = await qa.post('/api/posts', {
      data: { caption: `Panel hockey ${Date.now()}`, visibility: 'private', postType: 'ice_hockey', stats_data: { type: 'stat_line', sport_key: 'ice_hockey', date: '2026-09-10', stats: { goals: 1 } } },
    });
    expect(post.ok(), await readErrorBody(post)).toBe(true);
    postId = (await post.json()).post.id;
    const key = `post:${postId}`;
    for (let i = 0; i < 20; i++) {
      const { data } = await admin.from('athlete_performances').select('id').eq('natural_key', key).maybeSingle();
      if (data) break;
      await new Promise(r => setTimeout(r, 500));
    }
    await admin.from('athlete_performances').delete().eq('natural_key', key);

    await panel.locator('[data-backfill-live]').click();
    await page.getByRole('button', { name: 'Run for real' }).last().click();
    for (const source of ['golf_rounds', 'posts', 'contest_stat_lines', 'contest_results']) {
      await expect(panel.locator(`[data-backfill-source="${source}"]`)).toHaveAttribute('data-backfill-status', 'done', { timeout: 60_000 });
    }
    await expect(panel.locator('[data-backfill-source="posts"]')).not.toContainText('dry run');
    const { data: restored } = await admin.from('athlete_performances').select('metrics').eq('natural_key', key).maybeSingle();
    expect(restored?.metrics).toEqual({ goals: 1 });
  } finally {
    if (postId) await qa.delete(`/api/posts?postId=${postId}`).catch(() => {});
    await ctx.close();
    await qa.dispose();
    await deleteQaUser(adminUser.id);
  }
});
