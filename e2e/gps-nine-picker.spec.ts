import { test, expect, type Browser } from '@playwright/test';
import { adminClient, apiAs, readErrorBody } from './helpers/qa-user';
import { cleanup } from './helpers/cleanup';

// PR 4 (Oct 2026). Tom: a club whose nines are mapped but carry no labels is
// shown as PICKABLE nines — "A / B / C", letters never guessed names — drawn
// only after a pick or an unmistakable GPS match (a tee within 150 m, every
// rival tee clearly farther). Self-seeded as the stored `sections` shape:
// three nines side by side, 800 m apart.

type LatLng = [number, number];

async function phoneContext(browser: Browser, at: LatLng) {
  return browser.newContext({
    storageState: 'e2e/.auth/state.json',
    viewport: { width: 375, height: 740 },
    geolocation: { latitude: at[0], longitude: at[1], accuracy: 8 },
    permissions: ['geolocation'],
  });
}

const nine = (label: string, lng: number) => ({
  label,
  holes: Array.from({ length: 9 }, (_, i) => {
    const lat = 45.3 + i * 0.004;
    return { hole: i + 1, par: 4, line: [[lat, lng], [lat + 0.003, lng + 0.0004]] };
  }),
  greens: [],
});
const LNG_A = -75.72;
const LNG_B = -75.71; // ~780 m east of A at 45.3°N
const LNG_C = -75.70;

test('gps: unlabelled nines are pickable — nothing drawn before a pick, the pick survives a reload, a fix on a tee picks by itself @mobile', async ({ browser }) => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const api = await apiAs('state.json');
  const stamp = Date.now();
  let courseId = '';
  let roundId = '';
  const far = await phoneContext(browser, [45.4215, -75.6972]); // downtown Ottawa, ~13 km
  let onB: Awaited<ReturnType<typeof phoneContext>> | null = null;
  try {
    const seeded = await admin
      .from('golf_courses')
      .insert({
        external_source: 'qa-e2e',
        external_id: `nines-${stamp}`,
        name: `QA Three Nines ${stamp}`,
        lat: 45.3,
        lng: LNG_B,
        holes_count: 27,
        hole_data: Array.from({ length: 9 }, (_, i) => ({ number: i + 1, par: 4, yardage: { white: 350 }, handicap: i + 1 })),
        hole_geometry: { holes: [], source: 'osm', greens: [], sections: [nine('A', LNG_A), nine('B', LNG_B), nine('C', LNG_C)] },
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
        title: `QA Nines ${stamp}`,
        date: new Date().toISOString().split('T')[0],
        location: `QA Three Nines ${stamp}`,
        visibility: 'private',
        participant_ids: [],
        golf_data: { course_name: `QA Three Nines ${stamp}`, round_type: 'outdoor', holes_played: 9, tee_color: 'white', hole_data: Array.from({ length: 9 }, (_, i) => ({ hole: i + 1, par: 4, yardage: 350 })), course_id: courseId },
      },
    });
    expect(made.ok(), await readErrorBody(made)).toBe(true);
    roundId = (await made.json()).group_post.id as string;

    // Far away: the picker is offered, nothing is drawn, the chip says so.
    const page = await far.newPage();
    await page.goto(`/live/${roundId}`);
    await expect(page.getByText('Hole 1 media')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Open course map' }).click();
    await page.locator('[aria-label="Previous hole"]').waitFor({ timeout: 30_000 });
    const picker = page.locator('[data-loop-picker]');
    await expect(picker).toBeVisible({ timeout: 15_000 });
    await expect(picker.locator('[data-loop-pick]')).toHaveCount(3);
    await expect(page.locator('[data-hole-pick-nine]')).toHaveCount(1);
    await expect(page.locator('.leaflet-marker-pane [data-green-flag]')).toHaveCount(0);
    await expect(page.locator('[data-hole-unmapped]')).toHaveCount(0);

    // Pick B: the loop is drawn, the chip walks it, the flag stands on B's hole 1.
    await picker.locator('[data-loop-pick="front:B"]').click();
    await expect(picker.locator('[data-loop-pick="front:B"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-hole-pick-nine]')).toHaveCount(0);
    await expect(page.locator('.leaflet-marker-pane [data-green-flag]')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByText(/^Hole 1\b/)).toBeVisible();

    // The pick survives a reload on this device.
    await page.reload();
    await expect(page.getByText('Hole 1 media')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Open course map' }).click();
    await page.locator('[aria-label="Previous hole"]').waitFor({ timeout: 30_000 });
    await expect(page.locator('[data-loop-picker] [data-loop-pick="front:B"]')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
    await expect(page.locator('.leaflet-marker-pane [data-green-flag]')).toHaveCount(1, { timeout: 15_000 });

    // A fresh device standing on C's first tee: C is picked by itself (no pick stored).
    onB = await phoneContext(browser, [45.3, LNG_C]);
    const page2 = await onB.newPage();
    await page2.goto(`/live/${roundId}`);
    await expect(page2.getByText('Hole 1 media')).toBeVisible({ timeout: 30_000 });
    await page2.getByRole('button', { name: 'Open course map' }).click();
    await page2.locator('[aria-label="Previous hole"]').waitFor({ timeout: 30_000 });
    await expect(page2.locator('.leaflet-marker-pane [data-green-flag]')).toHaveCount(1, { timeout: 20_000 });
    await expect(page2.locator('[data-hole-pick-nine]')).toHaveCount(0);
    // …and no button reads pressed: the auto-pick is the fix's, not a stored choice.
    await expect(page2.locator('[data-loop-picker] [aria-pressed="true"]')).toHaveCount(0);
    const pill = page2.locator('[data-rangefinder-pill]');
    await expect(pill).toContainText(/\d+ yds to green/, { timeout: 15_000 });
  } finally {
    await cleanup('gps-nine-picker', [
      () => roundId && api.delete(`/api/group-posts/${roundId}?mode=delete`),
      () => courseId && admin.from('golf_courses').delete().eq('id', courseId),
      () => far.close(),
      () => onB?.close(),
      () => api.dispose(),
    ]);
  }
});
