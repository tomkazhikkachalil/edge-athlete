import { test, expect, type Browser } from '@playwright/test';
import { adminClient, readErrorBody, apiAs } from './helpers/qa-user';
import { cleanup } from './helpers/cleanup';
import { fitsViewportWidth } from './helpers/layout';

// M3 (Oct 2026). Tom: "a bold summary card at the top of a course — hole
// count, total yardage per tee, slope and rating, a map thumbnail labelled
// 'View course map' — and an explicit 'Not fully mapped' state instead of a
// half-empty preview." Two self-seeded courses on Explore's deep link
// (/sports/explore?course=<id> opens the golf chip with that card open):
// a RICH one and a THIN one. Both seed `hydrated_at: now` — the card asks
// `?id=` at open, and an unstamped non-seed row would spend a Nominatim
// call and may move the seeded pin.

async function phoneContext(browser: Browser) {
  return browser.newContext({ storageState: 'e2e/.auth/state.json', viewport: { width: 375, height: 740 } });
}

test('course preview: the summary card, the map thumbnail, and the Not fully mapped state @mobile', async ({ browser }) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const api = await apiAs('state.json');
  const stamp = Date.now();
  const holes = Array.from({ length: 18 }, (_, i) => {
    const lat = 61.3 + i * 0.004;
    return { hole: i + 1, par: 4, line: [[lat, -30.5], [lat + 0.003, -30.499]] };
  });
  const whiteTotal = Array.from({ length: 18 }, (_, i) => 350 + i).reduce((a, b) => a + b, 0);
  let richId = '';
  let thinId = '';
  const ctx = await phoneContext(browser);
  try {
    const rich = await admin
      .from('golf_courses')
      .insert({
        external_source: 'qa-e2e',
        external_id: `preview-rich-${stamp}`,
        name: `QA Preview Links ${stamp}`,
        lat: holes[0].line[0][0],
        lng: holes[0].line[0][1],
        holes_count: 18,
        total_par: 72,
        hole_data: holes.map((h, i) => ({ number: h.hole, par: 4, yardage: { white: 350 + i, blue: 380 + i }, handicap: h.hole })),
        course_rating: { white: 70.1, blue: 71.9 },
        slope_rating: { white: 125, blue: 133 },
        hole_geometry: { holes, source: 'osm', greens: [] },
        hole_geometry_at: new Date(stamp - 60_000).toISOString(),
        hydrated_at: new Date(stamp).toISOString(),
      })
      .select('id')
      .single();
    expect(rich.error, rich.error?.message).toBeNull();
    richId = rich.data!.id as string;
    const thin = await admin
      .from('golf_courses')
      .insert({
        external_source: 'qa-e2e',
        external_id: `preview-thin-${stamp}`,
        name: `QA Thin Preview ${stamp}`,
        lat: 61.5,
        lng: -30.5,
        hole_geometry: null,
        hole_geometry_at: new Date(stamp - 60_000).toISOString(),
        hydrated_at: new Date(stamp).toISOString(),
      })
      .select('id')
      .single();
    expect(thin.error, thin.error?.message).toBeNull();
    thinId = thin.data!.id as string;

    // The deep link lands the course's card open (the API answers the row).
    const probe = await api.get(`/api/golf/courses?id=${richId}`);
    expect(probe.ok(), await readErrorBody(probe)).toBe(true);

    const page = await ctx.newPage();
    await page.goto(`/sports/explore?course=${richId}`);
    const summary = page.locator('[data-course-summary=""]');
    await expect(summary).toBeVisible({ timeout: 30_000 });
    await expect(summary).toContainText('18 holes');
    await expect(summary).toContainText('Par 72');
    await expect(summary.locator('[data-course-tees]')).toContainText(`White ${whiteTotal.toLocaleString()} yds`);
    await expect(summary.locator('[data-course-tees]')).toContainText('70.1 / 125');
    await expect(summary.locator('[data-course-tees]')).toContainText('Blue');
    await expect(summary.locator('[data-course-unmapped]')).toHaveCount(0, { timeout: 15_000 });
    const thumb = summary.locator('[data-course-map-thumb]');
    await expect(thumb).toBeVisible();
    await expect(thumb).toContainText('View course map');
    await expect(thumb.locator('svg path')).toHaveCount(18, { timeout: 15_000 });
    const box = (await thumb.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await fitsViewportWidth(page)).toBe(true);
    await thumb.click();
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Previous hole' })).toBeVisible({ timeout: 15_000 });

    // The thin course: the explicit state, each gap named, no thumbnail lines.
    await page.goto(`/sports/explore?course=${thinId}`);
    const thinSummary = page.locator('[data-course-summary=""]');
    await expect(thinSummary).toBeVisible({ timeout: 30_000 });
    const unmapped = thinSummary.locator('[data-course-unmapped]');
    await expect(unmapped).toBeVisible({ timeout: 15_000 });
    await expect(unmapped).toContainText('Not fully mapped');
    await expect(unmapped.locator('[data-course-gap="no-hole-data"]')).toHaveCount(1);
    await expect(unmapped.locator('[data-course-gap="no-map-lines"]')).toHaveCount(1);
    await expect(thinSummary.locator('[data-course-map-thumb] svg path')).toHaveCount(0);
    expect(await fitsViewportWidth(page)).toBe(true);
  } finally {
    await cleanup('course-preview', [
      () => richId && admin.from('golf_courses').delete().eq('id', richId),
      () => thinId && admin.from('golf_courses').delete().eq('id', thinId),
      () => ctx.close(),
      () => api.dispose(),
    ]);
  }
});
