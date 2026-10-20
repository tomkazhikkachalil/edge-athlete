import { test, expect } from './helpers/test';
import { adminClient, adminEmailForE2E, createQaUser, deleteQaUser, loadEnv, mintStorageState, readErrorBody } from './helpers/qa-user';
import { adminContext } from './helpers/admin';

// The platform rollup (flow changes item 2b — H1, Oct 19 2026, migration
// 267): an owner recomputes a day through the console's door → the day's
// rows land in platform_stats_daily (today's new account is counted, the
// estimates and the open-ticket snapshot are there); a second recompute
// leaves exactly the same rows (delete-then-insert, no stale dim); a bad day
// is refused; a stranger (no console cookie) is 401; the cron door answers
// 202 with the secret and 401 without. Needs E2E_ADMIN_EMAIL +
// ADMIN_SESSION_SECRET on the target; skips with the reason. @mobile.

const adminEmail = adminEmailForE2E();
const todayUTC = () => new Date().toISOString().slice(0, 10);

test.describe('platform rollup (admin-positive)', () => {
  test.skip(!adminEmail, 'E2E_ADMIN_EMAIL unset — set it to an address in the target build\'s ADMIN_EMAILS');

  test('recompute a day: the rows, idempotence, the guards, the cron door @mobile', async ({ browser }) => {
    test.setTimeout(180_000);
    const admin = adminClient();
    const probe = await admin.from('platform_stats_daily').select('day').limit(1);
    test.skip(!!probe.error, `platform_stats_daily missing — run migration 267 (${probe.error?.message})`);
    const owner = await createQaUser({ email: adminEmail!, displayName: 'Edge QA Admin', firstName: 'Edge', lastName: 'Admin' });
    const stranger = await createQaUser({ displayName: 'Plain Pat', firstName: 'Plain', lastName: 'Pat' });
    let ownerCtx: Awaited<ReturnType<typeof adminContext>> | null = null;
    try {
      const probeDoor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const door = await probeDoor.request.post('/api/admin/session', { data: { email: 'probe@example.com', password: 'x' } });
      await probeDoor.close();
      test.skip(door.status() === 503, 'ADMIN_SESSION_SECRET unset on the target');
      ownerCtx = await adminContext(browser, owner);
      const day = todayUTC();

      // A stranger (app session, no console cookie) is refused; a bad day is refused.
      const strangerCtx = await browser.newContext({ storageState: await mintStorageState(stranger) });
      expect((await strangerCtx.request.post(`/api/admin/platform-stats/recompute?day=${day}`)).status()).toBe(401);
      await strangerCtx.close();
      expect((await ownerCtx.request.post('/api/admin/platform-stats/recompute?day=2099-01-01')).status()).toBe(400);
      expect((await ownerCtx.request.post('/api/admin/platform-stats/recompute?day=nope')).status()).toBe(400);

      // The recompute: today, every group.
      let res = await ownerCtx.request.post(`/api/admin/platform-stats/recompute?day=${day}`);
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const r = (await res.json()) as { ok: boolean; supported: boolean; ran: string[]; failed: unknown[]; rows: { metric: string; dim: string; value: number }[] };
      expect(r.supported).toBe(true);
      expect(r.failed).toEqual([]);
      expect(r.ran).toEqual(expect.arrayContaining(['users', 'cohorts', 'content', 'community', 'totals', 'site', 'storage']));
      const newUsers = r.rows.find(x => x.metric === 'users.new' && x.dim === '');
      expect(newUsers?.value).toBeGreaterThanOrEqual(2); // the two QA accounts made today
      expect(r.rows.find(x => x.metric === 'users.new' && x.dim === 'type:athlete')?.value).toBeGreaterThanOrEqual(1);
      expect(r.rows.find(x => x.metric === 'tickets.open')).toBeTruthy();
      expect(r.rows.some(x => x.metric === 'total' && x.dim === 'table:profiles')).toBe(true);
      expect(r.rows.some(x => x.metric === 'storage.bytes')).toBe(true);

      // The table holds exactly those rows; a second recompute changes nothing (no duplicates, no stale dims).
      const { data: first } = await admin.from('platform_stats_daily').select('metric, dim, value').eq('day', day).order('metric').order('dim');
      expect(first!.length).toBe(r.rows.length);
      res = await ownerCtx.request.post(`/api/admin/platform-stats/recompute?day=${day}`);
      expect(res.status()).toBe(200);
      const { data: second } = await admin.from('platform_stats_daily').select('metric, dim, value').eq('day', day).order('metric').order('dim');
      expect(second!.map(x => `${x.metric}|${x.dim}`)).toEqual(first!.map(x => `${x.metric}|${x.dim}`));

      // The cron door: 401 without the secret; with it, a 202 that starts the work.
      const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      expect((await anon.request.post('/api/cron/platform-rollup', { data: {} })).status()).toBe(401);
      await anon.close();
      loadEnv();
      const secret = process.env.CRON_SECRET;
      if (secret) {
        const cron = await ownerCtx.request.post('/api/cron/platform-rollup', { headers: { authorization: `Bearer ${secret}` }, data: { day } });
        expect(cron.status()).toBe(202);
        await expect.poll(async () => (await admin.from('platform_jobs').select('job').eq('job', 'platform-rollup').maybeSingle()).data?.job, { timeout: 60_000 }).toBe('platform-rollup');
      }
    } finally {
      await ownerCtx?.close();
      await deleteQaUser(stranger.id);
      await deleteQaUser(owner.id);
    }
  });
});
