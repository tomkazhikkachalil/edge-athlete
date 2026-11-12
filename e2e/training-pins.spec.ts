import { test, expect, request as pwRequest } from './helpers/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState, readErrorBody } from './helpers/qa-user';

// The pinned showcase (Training redesign PR 7, Nov 11 2026): the athlete pins
// up to six bests where each best is; they lead Training's Overview for a
// visitor too — each number folded for whoever is looking, never stored.

const DAY = 86_400_000;
const set = (reps: number, weight: number) => ({ setNumber: 1, reps, weight, weightUnit: 'lbs', durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media: [] });

test('pin an exercise\'s best and a test where they are; the Overview leads with them for a visitor too; six at most; the value is the viewer\'s @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = await createQaUser({ displayName: 'Pia Pinner', firstName: 'Pia', lastName: 'Pinner' });
  const visitor = await createQaUser({ displayName: 'Val Viewer', firstName: 'Val', lastName: 'Viewer' });
  const admin = adminClient();
  const ownerState = await mintStorageState(owner);
  const ownerApi = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: ownerState, extraHTTPHeaders: bypassHeaders() });
  const visitorState = await mintStorageState(visitor);
  const visitorApi = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: visitorState, extraHTTPHeaders: bypassHeaders() });
  const ctx = await browser.newContext({ storageState: ownerState, viewport: { width: 375, height: 812 }, extraHTTPHeaders: bypassHeaders() });
  const visitorCtx = await browser.newContext({ storageState: visitorState, viewport: { width: 375, height: 812 }, extraHTTPHeaders: bypassHeaders() });
  try {
    expect((await admin.from('profiles').update({ visibility: 'public' }).eq('id', owner.id)).error).toBeNull();
    const log = async (daysAgo: number, title: string, weight: number, fate: 'decided' | 'hidden') => {
      const res = await ownerApi.post('/api/workouts', { data: { mode: 'manual', startedAt: new Date(Date.now() - daysAgo * DAY).toISOString(), durationSeconds: 1800, title, exercises: [{ name: 'Bench Press', exerciseKey: 'bench_press', category: 'strength', notes: null, sets: [set(5, weight)] }] } });
      expect(res.ok(), await readErrorBody(res)).toBe(true);
      const id = (await res.json()).session.id as string;
      expect((await ownerApi.patch(`/api/workouts/${id}`, { data: { decided: true } })).ok()).toBe(true);
      if (fate === 'hidden') expect((await ownerApi.patch(`/api/workouts/${id}`, { data: { hidden: true } })).ok()).toBe(true);
    };
    await log(20, 'QA open', 185, 'decided');
    await log(10, 'QA hidden', 250, 'hidden');
    const dash = await ownerApi.post('/api/vitals', { data: { metric_key: '40_yard_dash', metric_category: 'speed', metric_label: '40-Yard Dash', unit: 'sec', value: 4.95, value_display: '4.95 sec', recorded_at: '2026-09-01' } });
    expect(dash.ok(), await readErrorBody(dash)).toBe(true);

    // ── The athlete, at phone width: nothing pinned shows nothing; pin where the best is.
    const page = await ctx.newPage();
    await page.goto('/athlete?tab=training');
    await expect(page.getByText('Sessions this week')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-training-pins]')).toHaveCount(0);

    await page.goto('/athlete?tab=training&view=exercises&exercise=bench_press');
    const benchPage = page.locator('[data-exercise-detail="bench_press"]');
    const benchPin = benchPage.locator('[data-pin-toggle="exercise:bench_press:heaviest"]');
    await expect(benchPin).toHaveAttribute('aria-pressed', 'false', { timeout: 30_000 });
    await benchPin.click();
    await expect(benchPin).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('dialog', { name: 'Bench Press' }).getByRole('button', { name: 'Close' }).click();

    const views = page.getByRole('tablist', { name: 'Training views' });
    await views.getByRole('tab', { name: 'Body & tests' }).click();
    await page.getByRole('button', { name: /40-Yard Dash/ }).first().click();
    const dashPin = page.locator('[data-pin-toggle="test:40_yard_dash"]');
    await dashPin.click();
    await expect(dashPin).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('dialog', { name: '40-Yard Dash' }).getByRole('button', { name: 'Close' }).click();

    // The Overview leads with them, in the order pinned — the owner's bench is the hidden 250.
    await views.getByRole('tab', { name: 'Overview' }).click();
    const showcase = page.locator('[data-training-pins]');
    await expect(showcase).toHaveAttribute('data-training-pins', '2', { timeout: 20_000 });
    const benchCard = showcase.locator('[data-training-pin="exercise:bench_press:heaviest"]');
    await expect(benchCard).toContainText('Bench Press');
    await expect(benchCard).toContainText('250 lbs');
    await expect(benchCard).toContainText('Heaviest');
    await expect(showcase.locator('[data-training-pin="test:40_yard_dash"]')).toContainText('4.95 sec');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // A pinned best opens its own page; a reload keeps the pins.
    await benchCard.click();
    await expect(page).toHaveURL(/\?tab=training&view=exercises&exercise=bench_press$/);
    await expect(page.locator('[data-exercise-detail="bench_press"]')).toBeVisible({ timeout: 20_000 });
    await page.goto('/athlete?tab=training');
    await expect(page.locator('[data-training-pins]')).toHaveAttribute('data-training-pins', '2', { timeout: 30_000 });

    // ── The API. The visitor's bench is 185 (never the hidden 250); the raw list is the athlete's alone.
    type Answer = { pins: Array<{ pin: { kind: string; ref: string }; label: string; kindLabel: string | null; display: string }>; mine?: unknown[]; hidden?: boolean; isOwner: boolean };
    const read = async (api: typeof ownerApi) => {
      const res = await api.get(`/api/profile/${owner.id}/training/pins`);
      expect(res.status()).toBe(200);
      expect(res.headers()['cache-control']).toBe('private, no-store');
      return (await res.json()) as Answer;
    };
    const theirs = await read(visitorApi);
    expect(theirs.mine).toBeUndefined();
    expect(theirs.pins.map(p => [p.label, p.kindLabel, p.display])).toEqual([['Bench Press', 'Heaviest', '185 lbs'], ['40-Yard Dash', null, '4.95 sec']]);
    expect(JSON.stringify(theirs)).not.toContain('250');
    expect((await read(ownerApi)).mine).toHaveLength(2);

    // Writing is the session's own list: the visitor's PUT changes the visitor's pins, never the athlete's.
    const put = (api: typeof ownerApi, pins: unknown) => api.put('/api/training/pins', { data: { pins } });
    expect((await put(visitorApi, [{ kind: 'exercise', ref: 'squat', recordKind: 'heaviest' }])).status()).toBe(200);
    expect((await read(ownerApi)).mine).toHaveLength(2);
    // Seven, a duplicate, a thing that is not a pin: refused whole, nothing written.
    const seven = ['heaviest', 'e1rm', 'reps', 'volume', 'duration'].map(recordKind => ({ kind: 'exercise', ref: 'squat', recordKind })).concat([{ kind: 'exercise', ref: 'deadlift', recordKind: 'heaviest' }, { kind: 'exercise', ref: 'bench_press', recordKind: 'heaviest' }]);
    for (const bad of [seven, [{ kind: 'test', ref: '40_yard_dash' }, { kind: 'test', ref: '40_yard_dash' }], [{ kind: 'effort', ref: 'run_5k' }], 'bench', null]) {
      expect((await put(ownerApi, bad)).status(), JSON.stringify(bad)).toBe(400);
    }
    expect((await read(ownerApi)).mine).toHaveLength(2);
    // A pin on something with no number counts toward the six and shows nothing.
    const withEmpty = await put(ownerApi, [{ kind: 'exercise', ref: 'bench_press', recordKind: 'heaviest' }, { kind: 'test', ref: '40_yard_dash' }, { kind: 'exercise', ref: 'squat', recordKind: 'heaviest' }]);
    expect(withEmpty.status()).toBe(200);
    const saved = (await withEmpty.json()) as Answer;
    expect(saved.mine).toHaveLength(3);
    expect(saved.pins).toHaveLength(2);

    // ── The visitor's screen: the same showcase, their numbers, no pin control anywhere.
    const visitorPage = await visitorCtx.newPage();
    await visitorPage.goto(`/athlete/${owner.id}?tab=training`);
    const theirShowcase = visitorPage.locator('[data-training-pins]');
    await expect(theirShowcase.locator('[data-training-pin="exercise:bench_press:heaviest"]')).toContainText('185 lbs', { timeout: 30_000 });
    await expect(visitorPage.getByText('250')).toHaveCount(0);
    await theirShowcase.locator('[data-training-pin="exercise:bench_press:heaviest"]').click();
    await expect(visitorPage.locator('[data-exercise-detail="bench_press"] [data-exercise-best="heaviest"]')).toContainText('185 lbs', { timeout: 20_000 });
    await expect(visitorPage.locator('[data-pin-toggle]')).toHaveCount(0);

    // Records private: no showcase for the visitor; the athlete's is untouched.
    expect((await admin.from('profiles').update({ vitals_privacy: { hidden: false, body: false, records: true, workouts: false } }).eq('id', owner.id)).error).toBeNull();
    const hidden = await read(visitorApi);
    expect(hidden.hidden).toBe(true);
    expect(hidden.pins).toEqual([]);
    expect((await read(ownerApi)).pins).toHaveLength(2);
    expect((await admin.from('profiles').update({ vitals_privacy: null }).eq('id', owner.id)).error).toBeNull();

    // ── Unpin where the best is: the card leaves the Overview.
    await page.goto('/athlete?tab=training&view=exercises&exercise=bench_press');
    const again = page.locator('[data-pin-toggle="exercise:bench_press:heaviest"]');
    await expect(again).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });
    await again.click();
    await expect(again).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => ((await read(ownerApi)).mine ?? []).length, { timeout: 15_000 }).toBe(2);
    await page.goto('/athlete?tab=training');
    await expect(page.locator('[data-training-pins]')).toHaveAttribute('data-training-pins', '1', { timeout: 30_000 });
    await expect(page.locator('[data-training-pin="exercise:bench_press:heaviest"]')).toHaveCount(0);
  } finally {
    await ctx.close();
    await visitorCtx.close();
    await ownerApi.dispose();
    await visitorApi.dispose();
    await deleteQaUser(owner.id);
    await deleteQaUser(visitor.id);
  }
});
