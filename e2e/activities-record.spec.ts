import { test, expect, type Browser, type BrowserContext } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// The recorder (Live Activities PR 4), as far as a browser can play it: a
// stubbed `watchPosition` feeds a scripted run; the screen marks a segment,
// survives a reload (the resume offer), finishes and saves — the row lands as
// `source 'live'` with the segment and a step estimate. A TIMEOUT from the
// phone keeps recording; PERMISSION_DENIED says where to turn it on. A timer
// type takes the distance at finish. Phone-width, as the real thing is.

const PHONE = { width: 390, height: 844 };
const LAT0 = 43.65;
const LNG0 = -79.38;

async function recorderContext(browser: Browser, opts: { mode: 'run' | 'timeout' | 'denied' }): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    storageState: 'e2e/.auth/state.json',
    viewport: PHONE,
    geolocation: { latitude: LAT0, longitude: LNG0, accuracy: 8 },
    permissions: ['geolocation'],
  });
  await ctx.addInitScript(
    ({ mode, lat0, lng0 }: { mode: string; lat0: number; lng0: number }) => {
      // Survive a reload: the scripted run continues from where it was.
      const key = 'e2e:record:step';
      navigator.geolocation.watchPosition = (success: PositionCallback, error?: PositionErrorCallback) => {
        const fail = (code: number) =>
          error?.({ code, message: 'stub', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
        if (mode === 'denied') {
          setTimeout(() => fail(1), 200);
          return 1;
        }
        if (mode === 'timeout') setTimeout(() => fail(3), 300);
        let n = Number(sessionStorage.getItem(key) ?? '0');
        const id = window.setInterval(() => {
          n += 1;
          sessionStorage.setItem(key, String(n));
          // 2.5 m every 500 ms north: 5 m/s — a brisk run, inside the type's limit.
          success({
            coords: { latitude: lat0 + (n * 2.5) / 111_195, longitude: lng0, accuracy: 7, altitude: 100 + n * 0.05, altitudeAccuracy: null, heading: null, speed: 5 },
            timestamp: Date.now(),
          } as GeolocationPosition);
        }, 500);
        return id;
      };
      navigator.geolocation.clearWatch = (id: number) => window.clearInterval(id);
    },
    { mode: opts.mode, lat0: LAT0, lng0: LNG0 }
  );
  return ctx;
}

test.beforeAll(async () => {
  const probe = await adminClient().from('activities').select('id, segments').limit(1);
  test.skip(!!probe.error, `migration 251 not applied on this target (${probe.error?.code})`);
});

test('record a run: fixes draw, a segment is marked, a reload resumes, Finish saves a live activity @mobile', async ({ browser, browserName }) => {
  test.skip(browserName === 'webkit', 'the scripted geolocation stub is Chromium-only in this harness');
  test.setTimeout(180_000);
  const user = loadQaUser('user.json');
  const admin = adminClient();
  await admin.from('activities').delete().eq('profile_id', user.id).eq('source', 'live');
  const ctx = await recorderContext(browser, { mode: 'run' });
  try {
    const page = await ctx.newPage();
    await page.goto('/activities/record');
    await page.locator('[data-record-type="run"]').click({ timeout: 20_000 });
    await expect(page.locator('[data-record-ready]')).toBeVisible();
    await page.locator('[data-record-start]').click();
    await expect(page.locator('[data-record-screen="recording"]')).toBeVisible();
    // Distance climbs as the fixes arrive; the timer runs.
    await expect.poll(async () => Number(await page.locator('[data-record-distance]').getAttribute('data-record-distance')), { timeout: 20_000 }).toBeGreaterThan(20);
    await expect(page.locator('[data-record-map] .leaflet-marker-icon')).toHaveCount(1, { timeout: 10_000 });
    // Mark → run a while → End → Sprint.
    await page.locator('[data-record-mark]').click();
    await expect(page.locator('[data-record-mark="open"]')).toBeVisible();
    await page.waitForTimeout(6_000);
    await page.locator('[data-record-mark]').click();
    await page.locator('[data-record-segment-kind="sprint"]').click();
    await expect(page.locator('[data-record-segments="1"]')).toBeVisible();
    // A reload: the recording is on the phone; resume it.
    await page.reload();
    await expect(page.locator('[data-record-resume-offer]')).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-record-resume-yes]').click();
    await expect(page.locator('[data-record-screen="paused"]')).toBeVisible();
    await expect(page.locator('[data-record-segments="1"]')).toBeVisible();
    await page.locator('[data-record-resume]').click();
    await expect(page.locator('[data-record-screen="recording"]')).toBeVisible();
    await page.waitForTimeout(3_000);
    // Finish → Save.
    await page.locator('[data-record-finish]').click();
    await expect(page.locator('[data-record-finish-sheet]')).toBeVisible();
    await page.locator('[data-record-save]').click();
    await page.waitForURL(/\/activities\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const id = page.url().split('/').pop()!;
    const { data: row } = await admin.from('activities').select('source, activity_type, segments, steps_source, distance_m, elapsed_s').eq('id', id).single();
    expect(row).toMatchObject({ source: 'live', activity_type: 'run', steps_source: 'estimated' });
    expect(row!.segments).toHaveLength(1);
    expect(row!.segments[0]).toMatchObject({ kind: 'sprint' });
    expect(Number(row!.distance_m)).toBeGreaterThan(30);
    expect(row!.elapsed_s).toBeGreaterThan(10);
    // Nothing left on the phone; the screen offers nothing to resume.
    await page.goto('/activities/record');
    await expect(page.locator('[data-record-type-picker]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-record-resume-offer]')).toHaveCount(0);
  } finally {
    await ctx.close();
    await admin.from('activities').delete().eq('profile_id', user.id).eq('source', 'live');
  }
});

test('a TIMEOUT keeps recording; PERMISSION_DENIED says where to turn it on @mobile', async ({ browser, browserName }) => {
  test.skip(browserName === 'webkit', 'the scripted geolocation stub is Chromium-only in this harness');
  test.setTimeout(120_000);
  for (const mode of ['timeout', 'denied'] as const) {
    const ctx = await recorderContext(browser, { mode });
    try {
      const page = await ctx.newPage();
      await page.goto('/activities/record');
      await page.locator('[data-record-type="walk"]').click({ timeout: 20_000 });
      await page.locator('[data-record-start]').click();
      await expect(page.locator('[data-record-screen="recording"]')).toBeVisible();
      if (mode === 'timeout') {
        await expect.poll(async () => Number(await page.locator('[data-record-distance]').getAttribute('data-record-distance')), { timeout: 20_000 }).toBeGreaterThan(5);
        await expect(page.locator('[data-record-gps="watching"]')).toBeVisible();
      } else {
        await expect(page.locator('[data-record-gps="denied"]')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText(/GPS is off for Edge Athlete/)).toBeVisible();
        // The timer runs on regardless.
        await expect.poll(async () => page.locator('[data-record-timer]').textContent(), { timeout: 10_000 }).not.toBe('0:00');
      }
      // Discard through the finish sheet, so the next case starts clean.
      await page.locator('[data-record-finish]').click();
      await page.locator('[data-record-discard]').click();
      await page.getByRole('button', { name: 'Discard' }).last().click();
      await expect(page.locator('[data-record-type-picker]')).toBeVisible({ timeout: 10_000 });
    } finally {
      await ctx.close();
    }
  }
});

test('a timer type: start, finish, type the distance, save @mobile', async ({ browser }) => {
  test.setTimeout(120_000);
  const user = loadQaUser('user.json');
  const admin = adminClient();
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport: PHONE });
  try {
    const page = await ctx.newPage();
    await page.goto('/activities/record');
    await page.locator('[data-record-type="swim"]').click({ timeout: 20_000 });
    await page.locator('[data-record-start]').click();
    await expect(page.locator('[data-record-map]')).toHaveCount(0);
    // Long enough that the typed distance is a plausible swim (the server
    // refuses a pace faster than the type's ceiling, 3 m/s for a swim).
    await page.waitForTimeout(12_000);
    await page.locator('[data-record-finish]').click();
    await expect(page.locator('[data-record-finish-sheet]')).toBeVisible();
    await expect(page.locator('[data-record-save]')).toBeDisabled(); // no distance yet
    await page.locator('[data-record-distance-input]').fill('25');
    await page.locator('[data-record-save]').click();
    await page.waitForURL(/\/activities\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const id = page.url().split('/').pop()!;
    const { data: row } = await admin.from('activities').select('source, activity_type, distance_m, has_route, steps').eq('id', id).single();
    expect(row).toMatchObject({ source: 'live', activity_type: 'swim', has_route: false, steps: null });
    expect(Number(row!.distance_m)).toBe(25);
    await admin.from('activities').delete().eq('id', id);
  } finally {
    await ctx.close();
    await admin.from('activities').delete().eq('profile_id', user.id).eq('source', 'live');
  }
});
