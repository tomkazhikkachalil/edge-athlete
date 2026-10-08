import { test, expect, type Browser } from '@playwright/test';
import { adminClient, apiAs, readErrorBody } from './helpers/qa-user';

// M1 (Oct 2026). Tom: "hole-by-hole browsing is lost for courses that are
// not fully mapped — the map jumps straight to the user's GPS location."
// A course with HOLE DATA but no OSM lines now gets the same ‹ › stepper
// (par and yardage per hole, "Not mapped yet" under each), the first-hole
// control, and a map that stays put: Follow decides OFF away from the
// course and the pan is the only thing it gates.
//
// Self-seeded. The two seeding rules: a fresh `hole_geometry_at` stops the
// Overpass fetch (a null geometry included); a fresh `hydrated_at` stops a
// provider / Nominatim attempt on a non-seed row.

type LatLng = [number, number];

async function phoneContext(browser: Browser, at: LatLng) {
  return browser.newContext({
    storageState: 'e2e/.auth/state.json',
    viewport: { width: 375, height: 740 },
    geolocation: { latitude: at[0], longitude: at[1], accuracy: 8 },
    permissions: ['geolocation'],
  });
}

test('gps: an unmapped course still browses hole by hole, and the map never jumps to a far-away fix @mobile', async ({ browser }) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const api = await apiAs('state.json');
  const stamp = Date.now();
  const pin: LatLng = [45.3, -75.7];
  let courseId = '';
  let roundId = '';
  const ctx = await phoneContext(browser, [45.4215, -75.6972]); // downtown Ottawa, ~13 km from the pin
  try {
    const seeded = await admin
      .from('golf_courses')
      .insert({
        external_source: 'qa-e2e',
        external_id: `unmapped-${stamp}`,
        name: `QA Unmapped Links ${stamp}`,
        lat: pin[0],
        lng: pin[1],
        hole_data: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, yardage: { white: 388 }, handicap: i + 1 })),
        course_rating: { white: 70.1 },
        slope_rating: { white: 125 },
        hole_geometry: null,
        hole_geometry_at: new Date().toISOString(),
        hydrated_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    expect(seeded.error, seeded.error?.message).toBeNull();
    courseId = seeded.data!.id as string;

    const made = await api.post('/api/group-posts', {
      data: {
        type: 'golf_round',
        title: `QA Unmapped ${stamp}`,
        date: new Date().toISOString().split('T')[0],
        location: `QA Unmapped Links ${stamp}`,
        visibility: 'private',
        participant_ids: [],
        golf_data: {
          course_name: `QA Unmapped Links ${stamp}`,
          round_type: 'outdoor',
          holes_played: 18,
          tee_color: 'white',
          hole_data: Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, yardage: 388 })),
          course_id: courseId,
        },
      },
    });
    expect(made.ok(), await readErrorBody(made)).toBe(true);
    roundId = (await made.json()).group_post.id as string;

    const page = await ctx.newPage();
    await page.goto(`/live/${roundId}`);
    await expect(page.getByText('Hole 1 media')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Open course map' }).click();

    // The stepper exists without a single line.
    await page.locator('[aria-label="Previous hole"]').waitFor({ timeout: 30_000 });
    await expect(page.getByText(/^Hole 1\b/)).toBeVisible();
    await expect(page.locator('[data-hole-unmapped]')).toHaveCount(1);
    await expect(page.getByText(/388 yds/)).toBeVisible();
    await expect(page.locator('.leaflet-marker-pane [data-green-flag]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Next hole' }).click();
    await expect(page.getByText(/^Hole 2\b/)).toBeVisible();
    await expect(page.locator('[data-hole-unmapped]')).toHaveCount(1);
    const firstHole = page.locator('[data-map-first-hole]');
    await expect(firstHole).toBeVisible();
    await expect(firstHole).toHaveAttribute('title', /no map line/);
    await firstHole.click();
    await expect(page.getByText(/^Hole 1\b/)).toBeVisible();

    // Far from the course: Follow decided OFF, and two fresh fixes move nothing.
    const follow = page.locator('[data-map-follow]');
    await expect(follow).toHaveAttribute('data-map-follow', 'off', { timeout: 15_000 });
    const coursePin = page.locator('.leaflet-marker-pane div[style*="7c3aed"]').first();
    await expect(coursePin).toBeVisible();
    const before = (await coursePin.boundingBox())!;
    await ctx.setGeolocation({ latitude: 45.4225, longitude: -75.6972, accuracy: 8 });
    await ctx.setGeolocation({ latitude: 45.4235, longitude: -75.6972, accuracy: 8 });
    await page.waitForTimeout(1500);
    const after = (await coursePin.boundingBox())!;
    expect(Math.abs(after.x - before.x), 'the map stayed on the course').toBeLessThan(1);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1);
    // Turning Follow on is one tap, and it pans to the player at once.
    await follow.click();
    await expect(follow).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(1200);
    const moved = await coursePin.boundingBox();
    expect(moved === null || Math.abs(moved.x - before.x) > 1 || Math.abs(moved.y - before.y) > 1, 'Follow on pans to the player').toBe(true);
  } finally {
    await ctx.close();
    if (roundId) await api.delete(`/api/group-posts/${roundId}?mode=delete`);
    if (courseId) await admin.from('golf_courses').delete().eq('id', courseId);
    await api.dispose();
  }
});
