import { test, expect, type Browser, type BrowserContext } from '@playwright/test';
import { apiAs, readErrorBody } from './helpers/qa-user';

/**
 * The on-course GPS pass, emulated (Aug 24 2026).
 *
 * The live round's Map tab is a rangefinder: it tracks the phone, shows the
 * yards to the focused hole's green, and lets the player drop a target to
 * measure a carry or layup from where they stand. That logic used to be
 * "device-only" to test. It isn't: Playwright grants the geolocation
 * permission and feeds coordinates, so this spec puts a phone on Eagle
 * Creek's first tee and walks it to the green, and a stubbed
 * `navigator.geolocation.watchPosition` reaches the error branches a real
 * course rarely does (a TIMEOUT mid-round used to kill tracking silently —
 * probe-caught, see CourseMapInner).
 *
 * What only a real phone can still tell you: GPS jitter under tree cover,
 * iOS Safari's behaviour when the screen sleeps or the app backgrounds, and
 * dragging the target elbow with a gloved thumb.
 *
 * Runs against localhost or a deployment (E2E_BASE_URL) — the geometry comes
 * from the same Supabase project either way. Skips, with a reason, if the
 * seeded Ottawa Eagle Creek row has no cached 18-hole geometry.
 */

type LatLng = [number, number];
interface HoleLine {
  hole: number;
  line: LatLng[];
}

// Inline haversine → yards (the app's helper lives behind the `@/` alias,
// which the Playwright transpiler does not resolve). Same constant as
// src/lib/golf/hole-geometry.ts.
function yardsBetween(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  const km = 2 * 6371 * Math.asin(Math.sqrt(h));
  return Math.round(km * 1093.6133);
}

const num = (s: string, re: RegExp) => {
  const m = s.match(re);
  return m ? Number(m[1]) : NaN;
};

/** Bounding box once it has stopped moving (two identical reads 250 ms apart). */
async function settledBox(locator: import('@playwright/test').Locator) {
  let last = await locator.boundingBox();
  for (let i = 0; i < 16; i++) {
    await new Promise(r => setTimeout(r, 250));
    const next = await locator.boundingBox();
    if (last && next && Math.abs(last.x - next.x) < 0.5 && Math.abs(last.y - next.y) < 0.5) return next;
    last = next;
  }
  if (!last) throw new Error('element never rendered');
  return last;
}

let groupPostId: string | null = null;
let hole1: HoleLine | null = null;

test.beforeAll(async () => {
  const api = await apiAs('state.json');
  try {
    // Discover the seeded Ottawa Eagle Creek row — never a hardcoded id.
    const search = await api.get('/api/golf/courses?q=eagle%20creek&limit=10');
    expect(search.ok(), await readErrorBody(search)).toBe(true);
    const courses = (await search.json()).courses as { id: string; name: string; city?: string; source?: string }[];
    const course = courses.find(c => c.source === 'seed' && c.city === 'Ottawa' && /eagle creek/i.test(c.name));
    if (!course) {
      test.skip(true, 'Seeded Ottawa Eagle Creek row not in the catalog');
      return;
    }
    const geo = await api.get(`/api/golf/courses?id=${course.id}&holes=1`);
    const holes = ((await geo.json()).geometry?.holes ?? null) as HoleLine[] | null;
    hole1 = holes?.find(h => h.hole === 1) ?? null;
    if (!holes || holes.length < 18 || !hole1 || hole1.line.length < 2) {
      test.skip(true, 'Eagle Creek has no cached 18-hole geometry in this environment');
      return;
    }
    // Pars only — the chip's "≈ yards" path; the round stays private.
    const res = await api.post('/api/group-posts', {
      data: {
        type: 'golf_round',
        title: `QA Rangefinder ${Date.now()}`,
        date: new Date().toISOString().split('T')[0],
        location: course.name,
        visibility: 'private',
        participant_ids: [],
        golf_data: {
          course_name: course.name,
          round_type: 'outdoor',
          holes_played: 18,
          hole_data: Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4 })),
          course_id: course.id,
        },
      },
    });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    groupPostId = (await res.json()).group_post.id as string;
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  if (!groupPostId) return;
  const api = await apiAs('state.json');
  try {
    await api.delete(`/api/group-posts/${groupPostId}`); // teardown's user delete is the backstop
  } finally {
    await api.dispose();
  }
});

async function openMap(ctx: BrowserContext, errors: string[]) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`/live/${groupPostId}`);
  // The scorer auto-opens for a scoreable round; its "Open course map" action
  // closes it and switches to the Map tab in one tap.
  await page.getByRole('button', { name: 'Open course map' }).click({ timeout: 20_000 });
  await page.locator('[aria-label="Previous hole"]').waitFor({ timeout: 30_000 });
  return page;
}

async function phoneContext(browser: Browser, at: LatLng) {
  return browser.newContext({
    storageState: 'e2e/.auth/state.json',
    viewport: { width: 375, height: 740 },
    geolocation: { latitude: at[0], longitude: at[1], accuracy: 8 },
    permissions: ['geolocation'],
  });
}

test('rangefinder: a phone walks hole 1 tee → green with a live fix', async ({ browser }) => {
  test.skip(!groupPostId || !hole1, 'fixture unavailable');
  const tee = hole1!.line[0];
  const green = hole1!.line[hole1!.line.length - 1];
  const mid: LatLng = [(tee[0] + green[0]) / 2, (tee[1] + green[1]) / 2];
  const errors: string[] = [];
  const ctx = await phoneContext(browser, tee);
  try {
    const page = await openMap(ctx, errors);
    const track = page.getByRole('button', { name: /Stop tracking|Track my position/ });
    // Permission already granted → tracking starts silently, no prompt.
    await expect(track).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
    const playerMarker = page.locator('.leaflet-marker-icon:has(div[style*="2563eb"])');
    await expect(playerMarker).toHaveCount(1);

    const greenPill = page.getByText(/\d+ yds to green/);
    await expect(greenPill).toBeVisible({ timeout: 5_000 });
    const chord = yardsBetween(tee, green);
    expect(Math.abs(num(await greenPill.innerText(), /(\d+) yds to green/) - chord)).toBeLessThanOrEqual(3);

    // Drop the target on the green: measured from the LIVE fix, not the tee.
    // Leaflet animates fitBounds — wait for the dot's screen position to
    // settle, or the tap lands where the green WAS a frame ago.
    const greenDot = page.locator('.leaflet-overlay-pane path[fill="#16a34a"]').first();
    const gb = await settledBox(greenDot);
    await page.mouse.click(gb.x + gb.width / 2, gb.y + gb.height / 2);
    const targetPill = page.getByText(/to target · \d+ to green/);
    await expect(targetPill).toBeVisible({ timeout: 5_000 });
    const t1 = (await targetPill.innerText()).replace(/\s+/g, ' ');
    expect(t1).not.toMatch(/from tee/);
    expect(num(t1, /· (\d+) to green/)).toBeLessThanOrEqual(5); // the target IS on the green
    expect(Math.abs(num(t1, /(\d+) to target/) - chord)).toBeLessThanOrEqual(8);

    // Walk to mid-hole: both pills follow the fix, still ONE marker.
    await ctx.setGeolocation({ latitude: mid[0], longitude: mid[1], accuracy: 6 });
    const half = yardsBetween(mid, green);
    await expect
      .poll(async () => num(await greenPill.innerText(), /(\d+) yds to green/), { timeout: 5_000 })
      .toBeLessThanOrEqual(half + 3);
    expect(Math.abs(num(await greenPill.innerText(), /(\d+) yds to green/) - half)).toBeLessThanOrEqual(3);
    expect(Math.abs(num(await targetPill.innerText(), /(\d+) to target/) - half)).toBeLessThanOrEqual(4);
    await expect(playerMarker).toHaveCount(1);

    // On the green.
    await ctx.setGeolocation({ latitude: green[0], longitude: green[1], accuracy: 5 });
    await expect
      .poll(async () => num(await greenPill.innerText(), /(\d+) yds to green/), { timeout: 5_000 })
      .toBeLessThanOrEqual(3);

    // Re-center is offered while a hole is focused + tracking; using it keeps tracking.
    const recenter = page.getByRole('button', { name: /Re-center/ });
    await expect(recenter).toBeVisible();
    await recenter.click();
    await expect(track).toHaveAttribute('aria-pressed', 'true');

    // Couch peek from downtown Ottawa: the to-green pill hides (1500-yd
    // cap); the deliberately placed target keeps counting.
    await ctx.setGeolocation({ latitude: 45.4215, longitude: -75.6972, accuracy: 20 });
    await expect(greenPill).toHaveCount(0, { timeout: 5_000 });
    await expect(targetPill).toHaveCount(1);

    expect(errors, errors.join(' | ')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('rangefinder: a transient TIMEOUT keeps tracking; PERMISSION_DENIED stops it', async ({ browser }) => {
  test.skip(!groupPostId || !hole1, 'fixture unavailable');
  const tee = hole1!.line[0];
  for (const [code, expectTracking] of [
    [3, true], // TIMEOUT — a golfer standing still trips it; must not stop the watch
    [1, false], // PERMISSION_DENIED — the only fatal code
  ] as const) {
    const ctx = await phoneContext(browser, tee);
    try {
      await ctx.addInitScript(
        ({ code, lat, lng }) => {
          navigator.geolocation.watchPosition = (
            success: PositionCallback,
            error?: PositionErrorCallback
          ) => {
            setTimeout(
              () =>
                error?.({
                  code,
                  message: 'stub',
                  PERMISSION_DENIED: 1,
                  POSITION_UNAVAILABLE: 2,
                  TIMEOUT: 3,
                } as GeolocationPositionError),
              300
            );
            if (code === 3) {
              setTimeout(
                () =>
                  success({
                    coords: {
                      latitude: lat,
                      longitude: lng,
                      accuracy: 9,
                      altitude: null,
                      altitudeAccuracy: null,
                      heading: null,
                      speed: null,
                    },
                    timestamp: Date.now(),
                  } as GeolocationPosition),
                900
              );
            }
            return 42;
          };
        },
        { code, lat: tee[0], lng: tee[1] }
      );
      const page = await openMap(ctx, []);
      const track = page.getByRole('button', { name: /Stop tracking|Track my position/ });
      if (expectTracking) {
        await expect(track).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
        await expect(page.locator('.leaflet-marker-icon:has(div[style*="2563eb"])')).toHaveCount(1, {
          timeout: 5_000,
        });
        await expect(page.getByText(/permission was denied/)).toHaveCount(0);
      } else {
        await expect(page.getByText(/permission was denied/)).toBeVisible({ timeout: 10_000 });
        await expect(track).toHaveAttribute('aria-pressed', 'false');
      }
    } finally {
      await ctx.close();
    }
  }
});
