import { test, expect, type Page } from './helpers/test';
import { adminClient, apiAs, loadQaUser } from './helpers/qa-user';
import { liveWire } from './helpers/activities';

// The Finish's questions (activities details A6, Oct 16 2026): effort 1–10,
// notes and the type's own answers, saved with the activity; the next Finish
// of the same type pre-fills the CHOICES only; the server refuses what the
// type's table does not allow.

const PHONE = { width: 375, height: 812 };

test.beforeAll(async () => {
  const probe = await adminClient().from('activities').select('id, effort, details').limit(1);
  test.skip(!!probe.error, `migration 265 not applied on this target (${probe.error?.code})`);
});

async function recordSwimToFinish(page: Page) {
  await page.goto('/activities/record');
  await page.locator('[data-record-type="swim"]').click({ timeout: 20_000 });
  await page.locator('[data-record-start]').click();
  // Long enough that 25 m is a plausible swim (the server refuses > 3 m/s).
  await page.waitForTimeout(12_000);
  await page.locator('[data-record-finish]').click();
  await expect(page.locator('[data-record-finish-sheet]')).toBeVisible();
  await page.locator('[data-record-distance-input]').fill('25');
}

test('a pool swim keeps its effort, pool and stroke; the next swim pre-fills the pool only @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  const user = loadQaUser('user.json');
  const admin = adminClient();
  await admin.from('activities').delete().eq('profile_id', user.id).eq('source', 'live');
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport: PHONE });
  try {
    const page = await ctx.newPage();
    await recordSwimToFinish(page);
    const form = page.locator('[data-finish-details="swim"]');
    await form.locator('[data-effort="7"]').click();
    await form.locator('[data-detail-field="pool"] [data-detail-option="25m"]').click();
    await form.locator('[data-detail-field="stroke"] [data-detail-option="freestyle"]').click();
    await form.locator('[data-finish-notes]').fill('Easy lanes');
    // Every chip is a real tap target.
    const box = await form.locator('[data-effort="10"]').boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await page.locator('[data-choice="only_me"]').click();
    await page.locator('[data-record-save]').click();
    await page.waitForURL(/\/activities\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const id = page.url().split('/').pop()!;

    const { data: row } = await admin.from('activities').select('effort, details, notes').eq('id', id).single();
    expect(row).toEqual({ effort: 7, details: { pool: '25m', stroke: 'freestyle' }, notes: 'Easy lanes' });
    await expect(page.locator('[data-activity-details]')).toHaveText('Pool 25 m · Freestyle');
    await expect(page.locator('[data-activity-tile="effort"]')).toContainText('7 / 10');
    await expect(page.locator('[data-activity-tile="lengths"]')).toContainText('1');

    // The next swim: the pool and the stroke are chosen, the effort is not.
    await recordSwimToFinish(page);
    const next = page.locator('[data-finish-details="swim"]');
    await expect(next.locator('[data-detail-field="pool"] [data-detail-option="25m"]')).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
    await expect(next.locator('[data-detail-field="stroke"] [data-detail-option="freestyle"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(next.locator('[data-effort][aria-checked="true"]')).toHaveCount(0);
    await expect(next.locator('[data-finish-notes]')).toHaveValue('');
    await page.locator('[data-record-discard]').click();
    await page.getByRole('button', { name: 'Discard' }).last().click();
  } finally {
    await ctx.close();
    await admin.from('activities').delete().eq('profile_id', user.id).eq('source', 'live');
  }
});

test('the server takes a row’s watts into its column and refuses what the type does not allow', async () => {
  test.setTimeout(90_000);
  const user = loadQaUser('user.json');
  const admin = adminClient();
  const api = await apiAs('state.json');
  const ids: string[] = [];
  try {
    const wire = () => {
      const w = liveWire({ type: 'row', n: 120, stepM: 0, stepS: 5 });
      return { ...w, lat: undefined, lng: undefined, device: { distanceM: 2000 } };
    };
    const bad = [
      { effort: 11 },
      { details: { setting: 'bathtub' } },
      { details: { pool: '25m' } },
      { details: { watts: 99_999 } },
      { mood: 'great' },
    ];
    for (const finish of bad) {
      const r = await api.post('/api/activities', { data: { activity: wire(), finish } });
      expect(r.status(), JSON.stringify(finish)).toBe(400);
    }
    const ok = await api.post('/api/activities', { data: { activity: wire(), finish: { effort: 8, details: { setting: 'machine', stroke_rate: 26, watts: 210 } } } });
    expect(ok.status(), await ok.text()).toBe(201);
    ids.push((await ok.json()).id);
    const { data: row } = await admin.from('activities').select('effort, details, avg_power, avg_cadence').eq('id', ids[0]).single();
    expect(row).toEqual({ effort: 8, details: { setting: 'machine' }, avg_power: 210, avg_cadence: 26 });

    // Edited after the fact; a type change clears the old answers.
    const edit = await api.patch(`/api/activities/${ids[0]}`, { data: { effort: 6, details: { setting: 'water' } } });
    expect(edit.status(), await edit.text()).toBe(200);
    expect((await edit.json()).activity).toMatchObject({ effort: 6, details: { setting: 'water' } });
    const retype = await api.patch(`/api/activities/${ids[0]}`, { data: { type: 'swim' } });
    expect((await retype.json()).activity.details).toEqual({});
  } finally {
    for (const id of ids) await api.delete(`/api/activities/${id}`).catch(() => undefined);
    await admin.from('activities').delete().eq('profile_id', user.id).eq('source', 'live');
    await api.dispose();
  }
});
