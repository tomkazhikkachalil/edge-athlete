import { test, expect, request as pwRequest } from './helpers/test';
import { adminSignIn } from './helpers/admin';
import { cleanup } from './helpers/cleanup';
import { adminClient, adminEmailForE2E, apiAs, bypassHeaders, createQaUser, deleteQaUser, mintStorageState, readErrorBody, E2E_BASE_URL } from './helpers/qa-user';

// Scorecard pars under review (Nov 20 2026; migration 317). A seeded course
// whose provider tee boxes disagree on four holes (Champlain's real shape):
// the gate, the list, an admin's decision that CHANGES a par (the card, the
// total and the record with the admin's email), one that KEEPS a par (the hole
// closes, nothing changes), the refusals, and the console panel with one tap,
// at desktop and phone width. Writes only its own seeded course, so it is not
// run against production. Skips without E2E_ADMIN_EMAIL; skips pre-317.
const adminEmail = adminEmailForE2E();
const pars = (s: string) => s.split('').map(Number);
const SAVED = '535344344534443444'; // hole 5 saved as a par 4 (total 70)
const BOXES: Array<[string, boolean, string]> = [['blue', true, '535354344534443444'], ['white', true, SAVED], ['yellow', true, '434344344434443444'], ['red', true, '434344344434443444'], ['white (f)', false, '535355344535443444']];

test('admin: disputed pars are listed, a decision corrects the card and is recorded, and the panel decides with one tap', async ({ browser }) => {
  test.skip(!adminEmail, 'E2E_ADMIN_EMAIL unset — set it to an address in the target build\'s ADMIN_EMAILS');
  test.skip(process.env.E2E_TARGET === 'prod', 'writes a seeded course: never against production');
  test.setTimeout(180_000);
  const admin = adminClient();
  const probe = await admin.from('golf_par_evidence').select('course_id').limit(1);
  test.skip(!!probe.error, 'migration 317 not applied on this target');

  const stamp = Date.now();
  const name = `QA Par Review ${stamp}`;
  const made = await admin.from('golf_courses').insert({
    external_source: 'qa-e2e', external_id: `par-review-${stamp}`, name, city: 'Testville', region: 'ON', total_par: 70, holes_count: 18,
    hole_data: pars(SAVED).map((par, i) => ({ number: i + 1, par, yardage: { blue: 400 + i }, handicap: i + 1 })),
    sheet_sources: { pars: 'golfcourseapi', parsDisputed: [1, 3, 5, 10] },
  }).select('id').single();
  expect(made.error, made.error?.message).toBeNull();
  const courseId = made.data!.id as string;
  expect((await admin.from('golf_par_evidence').insert(BOXES.map(([label, votes, p]) => ({ course_id: courseId, source: 'golfcourseapi', label, votes, pars: pars(p) })))).error).toBeNull();

  const qa = await apiAs('state.json');
  const anon = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: bypassHeaders() });
  const adminUser = await createQaUser({ email: adminEmail!, displayName: 'Edge QA Admin', firstName: 'Edge', lastName: 'Admin' });
  const adminApi = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(adminUser), extraHTTPHeaders: bypassHeaders() });
  const ctx = await browser.newContext({ storageState: await mintStorageState(adminUser) });
  const card = async () => (await admin.from('golf_courses').select('total_par, hole_data').eq('id', courseId).single()).data as { total_par: number; hole_data: Array<{ number: number; par: number; yardage: Record<string, number>; handicap: number }> };
  try {
    await adminSignIn(adminApi, adminUser);
    await adminSignIn(ctx, adminUser);

    // The gate, reading and deciding.
    expect((await anon.get('/api/admin/golf-par-review')).status()).toBe(401);
    expect((await qa.get('/api/admin/golf-par-review')).status()).toBe(401);
    expect((await qa.post('/api/admin/golf-par-review', { data: { courseId, hole: 5, par: 5 } })).status()).toBe(401);

    // The list: the seeded course, its four open holes, who says what.
    const list = await adminApi.get('/api/admin/golf-par-review');
    expect(list.ok(), await readErrorBody(list)).toBe(true);
    expect(list.headers()['cache-control']).toContain('no-store');
    const review = await list.json() as { courses: Array<{ courseId: string; name: string; holes: Array<{ hole: number; saved: number; candidates: number[]; boxes: Record<string, number | null> }> }> };
    const mine = review.courses.find(c => c.courseId === courseId)!;
    expect(mine, 'the seeded course is on the list').toBeTruthy();
    expect(mine.holes.map(h => h.hole)).toEqual([1, 3, 5, 10]);
    expect(mine.holes.find(h => h.hole === 5)).toMatchObject({ saved: 4, candidates: [4, 5], boxes: { blue: 5, white: 4, yellow: 4, red: 4, 'white (f)': 5 } });

    // Refusals: nothing changes.
    expect((await adminApi.post('/api/admin/golf-par-review', { data: { courseId, hole: 5, par: 7 } })).status()).toBe(400);
    expect((await adminApi.post('/api/admin/golf-par-review', { data: { courseId, hole: 19, par: 4 } })).status()).toBe(400);
    const noNote = await adminApi.post('/api/admin/golf-par-review', { data: { courseId, hole: 5, par: 6 } });
    expect(noNote.status()).toBe(400);
    expect((await noNote.json()).code).toBe('note_required');
    expect((await card()).total_par).toBe(70);

    // A decision that changes a par: that hole, the total, nothing else; recorded with the admin's email.
    const change = await adminApi.post('/api/admin/golf-par-review', { data: { courseId, hole: 5, par: 5, note: 'the club card' } });
    expect(change.ok(), await readErrorBody(change)).toBe(true);
    expect(await change.json()).toMatchObject({ changed: true, corrections: [{ hole: 5, from: 4, to: 5, reason: 'admin' }], stillOpen: [1, 3, 10] });
    const after = await card();
    expect(after.total_par).toBe(71);
    expect(after.hole_data.map(h => h.par).join('')).toBe('535354344534443444');
    expect(after.hole_data[4]).toEqual({ number: 5, par: 5, yardage: { blue: 404 }, handicap: 5 });
    const log = await admin.from('golf_par_changes').select('hole, from_par, to_par, reason, actor, note').eq('course_id', courseId);
    expect(log.data).toEqual([{ hole: 5, from_par: 4, to_par: 5, reason: 'admin', actor: adminEmail, note: 'the club card' }]);

    // The panel: the course, its three open holes, and one tap that KEEPS hole 1's par.
    const page = await ctx.newPage();
    await page.goto('/admin');
    const panel = page.locator('[data-admin-golf-par-review]');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    const row = panel.locator(`[data-par-review-course="${courseId}"]`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.locator('[data-par-review-hole]')).toHaveCount(3);
    const hole1 = row.locator('[data-par-review-hole="1"]');
    await expect(hole1).toContainText('saved as par 5');
    await expect(hole1.locator('[data-par-review-says]')).toContainText('par 5: blue, white');
    await expect(hole1.locator('[data-par-review-set="5"]')).toHaveText('Keep par 5');
    await expect(hole1.locator('[data-par-review-set="4"]')).toHaveText('Change to par 4');
    await expect(panel.locator('[data-par-review-change]').filter({ hasText: name })).toContainText(`hole 5: par 4 to 5 · decided by ${adminEmail}`);
    // Phone width before the tap: the panel and its buttons stay inside the screen.
    await page.setViewportSize({ width: 375, height: 812 });
    await row.scrollIntoViewIfNeeded();
    const box = await panel.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    for (const b of await row.locator('[data-par-review-set]').all()) {
      const bb = await b.boundingBox();
      expect(bb!.x + bb!.width, 'a par button inside the screen').toBeLessThanOrEqual(375);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll at 375 px').toBe(true);
    await hole1.locator('[data-par-review-set="5"]').click();
    // The answer shows AT the course that was tapped, on screen, and the hole
    // leaves the list at once (Nov 20 2026: the line sat at the top of the
    // panel and the list took seconds, so a tap that worked looked dead).
    const said = row.locator('[data-par-review-outcome]');
    await expect(said).toContainText('Hole 1: par 5 kept. Recorded as decided.', { timeout: 10_000 });
    await expect(said).toBeInViewport();
    await expect(row.locator('[data-par-review-hole]')).toHaveCount(2, { timeout: 5_000 });
    await expect(row.locator('[data-par-review-hole="1"]')).toHaveCount(0);
    // The list itself reads quickly however many courses hold evidence.
    const t0 = Date.now();
    expect((await adminApi.get('/api/admin/golf-par-review')).ok()).toBe(true);
    expect(Date.now() - t0, 'the review list answers within three seconds').toBeLessThan(3_000);
    // Keeping a par changed no card and recorded no change.
    expect((await card()).total_par).toBe(71);
    expect((await admin.from('golf_par_changes').select('id').eq('course_id', courseId)).data).toHaveLength(1);
  } finally {
    await cleanup('admin-golf-par-review', [
      () => admin.from('golf_par_changes').delete().eq('course_id', courseId),
      () => admin.from('golf_courses').delete().eq('id', courseId),
      () => deleteQaUser(adminUser.id),
      () => ctx.close(),
      () => adminApi.dispose(),
      () => anon.dispose(),
      () => qa.dispose(),
    ]);
  }
});
