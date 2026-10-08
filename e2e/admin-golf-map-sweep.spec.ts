import { test, expect, request as pwRequest } from '@playwright/test';
import { cleanup } from './helpers/cleanup';
import {
  adminClient, adminEmailForE2E, apiAs, bypassHeaders, createQaUser, deleteQaUser, mintStorageState, readErrorBody, E2E_BASE_URL,
} from './helpers/qa-user';

// The course-map sweep's door (map sweep PR 7, Oct 2026; migration 255).
// Three sweepable catalog rows are seeded in the middle of the Atlantic
// (cell c05:61.0:-30.5 — no golf course within a thousand kilometres, so
// OpenStreetMap answers nothing and every outcome is honest) beside one
// `qa-e2e` row the planner must ignore. The gate (anonymous 401, a signed-in
// athlete 403), the plan (dry run writes no cell; live writes ONE cell with
// three courses), a dry geometry batch stamps nothing, and a live one-cell
// run ends in EITHER of its two contracts — `done` with every row stamped
// as "no coverage", or `pending` with one attempt and NO row stamped (a
// public mirror's bad minute). Then the dashboard panel renders the counts.
// Skips without E2E_ADMIN_EMAIL; skips pre-255.
const adminEmail = adminEmailForE2E();
const CELL = 'c05:61.0:-30.5';

test('admin: the golf map sweep plans a cell, dry-runs nothing, sweeps one cell honestly, and the panel renders', async ({ browser }) => {
  test.skip(!adminEmail, 'E2E_ADMIN_EMAIL unset — set it to an address in the target build\'s ADMIN_EMAILS');
  test.setTimeout(240_000);
  const admin = adminClient();
  const probe = await admin.from('golf_map_sweep_cells').select('cell_key').limit(1);
  test.skip(!!probe.error && (probe.error.code === '42P01' || probe.error.code === 'PGRST205'), 'migration 255 not applied on this target');

  const stamp = Date.now();
  const qa = await apiAs('state.json');
  const anon = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: bypassHeaders() });
  const adminUser = await createQaUser({ email: adminEmail!, displayName: 'Edge QA Admin', firstName: 'Edge', lastName: 'Admin' });
  const adminApi = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(adminUser), extraHTTPHeaders: bypassHeaders() });
  const ctx = await browser.newContext({ storageState: await mintStorageState(adminUser) });
  const courseIds: string[] = [];
  let qaRowId = '';
  try {
    // Three sweepable rows (`seed` + a `qa-` external id — the staging sweep's
    // class) and one `qa-e2e` row the planner and the cell must skip.
    for (let i = 0; i < 3; i++) {
      const seeded = await admin
        .from('golf_courses')
        .insert({
          external_source: 'seed',
          external_id: `qa-sweep-${stamp}-${i}`,
          name: `QA Sweep Atlantic ${stamp} ${i}`,
          lat: 61.3 + i * 0.01,
          lng: -30.5 + i * 0.01,
          country_code: 'ZZ',
          hole_geometry: null,
          hole_geometry_at: null,
          hydrated_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      expect(seeded.error, seeded.error?.message).toBeNull();
      courseIds.push(seeded.data!.id as string);
    }
    const qaRow = await admin
      .from('golf_courses')
      .insert({ external_source: 'qa-e2e', external_id: `qa-sweep-fixture-${stamp}`, name: `QA Sweep Fixture ${stamp}`, lat: 61.31, lng: -30.49, hydrated_at: new Date().toISOString() })
      .select('id')
      .single();
    expect(qaRow.error, qaRow.error?.message).toBeNull();
    qaRowId = qaRow.data!.id as string;

    // The gate.
    const anonGet = await anon.get('/api/admin/golf-map-sweep');
    expect(anonGet.status()).toBe(401);
    const denied = await qa.post('/api/admin/golf-map-sweep', { data: { phase: 'plan' } });
    expect(denied.status()).toBe(403);
    const badPhase = await adminApi.post('/api/admin/golf-map-sweep', { data: { phase: 'everything' } });
    expect(badPhase.status()).toBe(400);
    const badKey = await adminApi.post('/api/admin/golf-map-sweep', { data: { phase: 'geometry', cellKey: 'ottawa' } });
    expect(badKey.status()).toBe(400);

    // Plan: dry writes no cell; live writes ours with the three courses.
    await admin.from('golf_map_sweep_cells').delete().eq('cell_key', CELL);
    const planDry = await adminApi.post('/api/admin/golf-map-sweep', { data: { phase: 'plan' } });
    expect(planDry.ok(), await readErrorBody(planDry)).toBe(true);
    const planDryBody = await planDry.json();
    expect(planDryBody.dryRun).toBe(true);
    expect(planDryBody.courses).toBeGreaterThanOrEqual(3);
    expect((await admin.from('golf_map_sweep_cells').select('cell_key').eq('cell_key', CELL)).data).toEqual([]);

    const planLive = await adminApi.post('/api/admin/golf-map-sweep', { data: { phase: 'plan', dryRun: false } });
    expect(planLive.ok(), await readErrorBody(planLive)).toBe(true);
    const cell = await admin.from('golf_map_sweep_cells').select('cell_key, tier, status, courses, attempts').eq('cell_key', CELL).maybeSingle();
    expect(cell.data, 'the plan wrote our cell').toMatchObject({ cell_key: CELL, tier: 3, status: 'pending', courses: 3, attempts: 0 });

    // A dry geometry batch on the cell stamps nothing and releases it.
    const dry = await adminApi.post('/api/admin/golf-map-sweep', { data: { phase: 'geometry', cellKey: CELL } });
    expect(dry.ok(), await readErrorBody(dry)).toBe(true);
    const dryBody = await dry.json();
    expect(dryBody).toMatchObject({ phase: 'geometry', dryRun: true });
    expect(dryBody.cells[0]).toMatchObject({ cell_key: CELL, outcome: 'dry_run' });
    const afterDry = await admin.from('golf_courses').select('id, hole_geometry_at').in('id', courseIds);
    expect(afterDry.data!.every(r => r.hole_geometry_at === null), 'a dry run stamps nothing').toBe(true);
    expect((await admin.from('golf_map_sweep_cells').select('status').eq('cell_key', CELL).single()).data!.status).toBe('pending');

    // The live one-cell run: both contracts are honest.
    const live = await adminApi.post('/api/admin/golf-map-sweep', { data: { phase: 'geometry', cellKey: CELL, dryRun: false } });
    expect(live.ok(), await readErrorBody(live)).toBe(true);
    const liveBody = await live.json();
    expect(liveBody.dryRun).toBe(false);
    const outcome = liveBody.cells[0];
    expect(outcome.cell_key).toBe(CELL);
    const rows = await admin.from('golf_courses').select('id, hole_geometry, hole_geometry_at').in('id', courseIds);
    const stamped = rows.data!.filter(r => r.hole_geometry_at !== null);
    const cellAfter = await admin.from('golf_map_sweep_cells').select('status, attempts, null_no_coverage, attempted').eq('cell_key', CELL).single();
    if (outcome.outcome === 'done') {
      expect(stamped.length, 'every row stamped').toBe(3);
      expect(rows.data!.every(r => r.hole_geometry === null), 'nothing in the Atlantic').toBe(true);
      expect(cellAfter.data).toMatchObject({ status: 'done', attempts: 0, attempted: 3, null_no_coverage: 3 });
    } else {
      expect(outcome.outcome, 'a public mirror\'s bad minute parks the cell').toBe('transport');
      expect(stamped.length, 'a transport failure stamps nothing').toBe(0);
      expect(cellAfter.data).toMatchObject({ status: 'pending', attempts: 1 });
    }
    const fixture = await admin.from('golf_courses').select('hole_geometry_at').eq('id', qaRowId).single();
    expect(fixture.data!.hole_geometry_at, 'the qa-e2e row is never the sweep\'s').toBeNull();

    // The panel.
    const page = await ctx.newPage();
    await page.goto('/dashboard');
    const panel = page.locator('[data-admin-golf-map-sweep]');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel.locator('[data-sweep-cells]')).toContainText('done', { timeout: 20_000 });
    await expect(panel.locator('[data-sweep-courses]')).toContainText('swept');
    await expect(panel.locator('[data-sweep-cell-key]')).toHaveValue('c05:45.0:-76.0');
    await expect(panel.locator('[data-sweep-live]')).toBeEnabled();
  } finally {
    await cleanup('admin-golf-map-sweep', [
      () => admin.from('golf_map_sweep_cells').delete().eq('cell_key', CELL),
      () => courseIds.length && admin.from('golf_courses').delete().in('id', courseIds),
      () => qaRowId && admin.from('golf_courses').delete().eq('id', qaRowId),
      () => deleteQaUser(adminUser.id),
      () => ctx.close(),
      () => adminApi.dispose(),
      () => anon.dispose(),
      () => qa.dispose(),
    ]);
  }
});
