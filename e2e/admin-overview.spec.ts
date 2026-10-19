import { test, expect } from './helpers/test';
import { adminClient, adminEmailForE2E, createQaUser, deleteQaUser, mintStorageState, readErrorBody } from './helpers/qa-user';
import { adminContext } from './helpers/admin';

// The Overview (flow changes item 2b — H2, Oct 19 2026): the console home
// opens on health, growth, activity, community and platform, every number
// read from the small tables. The spec seeds a few days of rows and health
// samples (with a gap), reads the API (zero-filled days, the previous-window
// delta, uptime against EXPECTED slots), sees the page render them at 375 px,
// switches the range, opens a chart's table view, and checks a stranger is
// refused. Needs E2E_ADMIN_EMAIL + ADMIN_SESSION_SECRET; skips otherwise.
// @mobile.

const adminEmail = adminEmailForE2E();
const dayUTC = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

test.describe('admin overview (admin-positive)', () => {
  test.skip(!adminEmail, 'E2E_ADMIN_EMAIL unset — set it to an address in the target build\'s ADMIN_EMAILS');

  test('the API shape, the page, the range, the table view, the stranger @mobile', async ({ browser }) => {
    test.setTimeout(180_000);
    const admin = adminClient();
    const probe = await admin.from('platform_stats_daily').select('day').limit(1);
    test.skip(!!probe.error, `platform_stats_daily missing — run migration 267 (${probe.error?.message})`);
    const owner = await createQaUser({ email: adminEmail!, displayName: 'Edge QA Admin', firstName: 'Edge', lastName: 'Admin' });
    const stranger = await createQaUser({ displayName: 'Plain Pat', firstName: 'Plain', lastName: 'Pat' });
    const seededDays = [dayUTC(1), dayUTC(2), dayUTC(3)];
    const seedMetric = 'posts.new';
    let ownerCtx: Awaited<ReturnType<typeof adminContext>> | null = null;
    // Health samples: 11 of the last 12 five-minute slots, one failed, one missing → uptime 10/12 of the hour's expectation only matters in the 24 h window; we assert the shape and monotonicity.
    const sampleAts = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => new Date(Date.now() - m * 60_000).toISOString());
    try {
      const probeDoor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const door = await probeDoor.request.post('/api/admin/session', { data: { email: 'probe@example.com', password: 'x' } });
      await probeDoor.close();
      test.skip(door.status() === 503, 'ADMIN_SESSION_SECRET unset on the target');

      // Seed: three days of posts (12, 7, 0 is a missing row on a rolled day via another metric) — note the rows are whatever the nightly wrote plus ours.
      await admin.from('platform_stats_daily').delete().eq('metric', seedMetric).in('day', seededDays);
      const { error: seedErr } = await admin.from('platform_stats_daily').upsert([
        { day: seededDays[0], metric: seedMetric, dim: '', value: 12 },
        { day: seededDays[1], metric: seedMetric, dim: '', value: 7 },
        { day: seededDays[2], metric: 'users.dau', dim: '', value: 3 }, // rolled day without a posts row → 0 in the series
      ], { onConflict: 'day,metric,dim' });
      expect(seedErr).toBeNull();
      await admin.from('platform_health_samples').delete().in('at', sampleAts);
      const { error: hsErr } = await admin.from('platform_health_samples').insert(sampleAts.map((at, i) => ({ at, db_ms: 40 + i * 5, ok: i !== 10 })));
      expect(hsErr).toBeNull();

      ownerCtx = await adminContext(browser, owner, { viewport: { width: 375, height: 812 } });

      // A stranger with only an app session is refused.
      const strangerCtx = await browser.newContext({ storageState: await mintStorageState(stranger) });
      expect((await strangerCtx.request.get('/api/admin/overview?range=7')).status()).toBe(401);
      await strangerCtx.close();

      // The API: the 7-day shape.
      const res = await ownerCtx.request.get('/api/admin/overview?range=7');
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const body = (await res.json()) as {
        supported: boolean; days: string[]; range: { days: number; to: string };
        activity: { posts: { series: (number | null)[]; current: number } };
        platform: { health: { sampler: string; h24: { samples: number; expected: number; uptime: number | null; p50: number | null; p95: number | null } }; jobs: { job: string }[] };
        growth: { usersTotal: { reltuples: number } | null };
        today: { supported: boolean };
      };
      expect(body.supported).toBe(true);
      expect(body.range.days).toBe(7);
      expect(body.days).toHaveLength(7);
      expect(body.days[6]).toBe(dayUTC(1));
      const posts = body.activity.posts.series;
      expect(posts[6]).toBe(12);
      expect(posts[5]).toBe(7);
      expect(posts[4]).toBe(0); // a rolled day without a posts row
      expect(body.activity.posts.current).toBeGreaterThanOrEqual(19);
      expect(body.platform.health.h24.samples).toBeGreaterThanOrEqual(11);
      expect(body.platform.health.h24.expected).toBe(288);
      expect(body.platform.health.h24.uptime).not.toBeNull();
      expect(body.platform.health.h24.uptime!).toBeLessThanOrEqual(1);
      expect(body.platform.health.h24.p95).toBeGreaterThanOrEqual(body.platform.health.h24.p50!);
      expect(body.platform.health.sampler).toBe('ok');
      expect(body.growth.usersTotal).not.toBeNull();
      expect(body.today.supported).toBe(true);
      expect((await ownerCtx.request.get('/api/admin/overview?range=999')).status()).toBe(200); // falls back to 30

      // The page at 375 px: the sections, the seeded number, the range switch, a chart's table view.
      const page = await ownerCtx.newPage();
      await page.goto('/admin');
      await expect(page.locator('[data-overview]')).toBeVisible({ timeout: 30_000 });
      await page.locator('[data-overview-range="7"]').click();
      await expect(page.locator('[data-overview-section="health"]')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-overview-section="growth"]')).toBeVisible();
      await expect(page.locator('[data-overview-section="activity"]')).toBeVisible();
      await expect(page.locator('[data-overview-section="community"]')).toBeVisible();
      await expect(page.locator('[data-overview-section="platform"]')).toBeVisible();
      await expect(page.locator('[data-overview-tile="posts"] [data-overview-value]')).toHaveAttribute('data-overview-value', /^\d+$/);
      const postsValue = Number(await page.locator('[data-overview-tile="posts"] [data-overview-value]').getAttribute('data-overview-value'));
      expect(postsValue).toBeGreaterThanOrEqual(19);
      await expect(page.locator('[data-overview-tile="uptime-24h"]')).toContainText('%');
      await expect(page.locator('[data-overview-tile="users-total"]')).toContainText('≈');
      const chart = page.locator('[data-overview-chart="posts"]');
      await expect(chart).toBeVisible();
      await chart.locator('[data-overview-table-toggle]').click();
      await expect(chart.locator('[data-overview-table]')).toBeVisible();
      await expect(chart.locator('[data-overview-table] tbody tr')).toHaveCount(7);
      await expect(chart.locator('[data-overview-table]')).toContainText('12');
      await page.locator('[data-overview-range="30"]').click();
      await expect(page.locator('[data-overview-tile="posts"]')).toContainText('30 d', { timeout: 30_000 });
      await expect(page.locator('[data-overview-jobs]')).toBeVisible();
      if (process.env.E2E_DUMP_DIR) {
        // The console cookie carries no theme, so the device's default schedule would decide: pin light first, then dark.
        const themeCookie = (mode: 'off' | 'on') => ({ name: 'ea-theme', value: Buffer.from(JSON.stringify({ mode })).toString('base64'), url: page.url() });
        await ownerCtx.addCookies([themeCookie('off')]);
        await page.reload();
        await expect(page.locator('[data-overview-section="platform"]')).toBeVisible({ timeout: 30_000 });
        await page.screenshot({ path: `${process.env.E2E_DUMP_DIR}/admin-overview-${test.info().project.name}.png`, fullPage: true });
        // The dark theme is the account's / device's choice (the ea-theme cookie, base64 JSON of the prefs; mode 'on' pins dark).
        await ownerCtx.addCookies([themeCookie('on')]);
        await page.reload();
        await expect(page.locator('[data-overview-section="platform"]')).toBeVisible({ timeout: 30_000 });
        await page.screenshot({ path: `${process.env.E2E_DUMP_DIR}/admin-overview-${test.info().project.name}-dark.png`, fullPage: true });
      }
    } finally {
      await ownerCtx?.close();
      await admin.from('platform_stats_daily').delete().eq('metric', seedMetric).in('day', seededDays);
      await admin.from('platform_stats_daily').delete().eq('metric', 'users.dau').eq('day', seededDays[2]).eq('value', 3);
      await admin.from('platform_health_samples').delete().in('at', sampleAts);
      await deleteQaUser(stranger.id);
      await deleteQaUser(owner.id);
    }
  });
});
