import { test, expect, type Browser } from '@playwright/test';
import { adminClient, apiAs, readErrorBody } from './helpers/qa-user';

type LatLng = [number, number];
interface HoleLine {
  hole: number;
  line: LatLng[];
}

/** Bounding box once it has stopped moving (Leaflet animates fitBounds). */
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

async function phoneContext(browser: Browser, at: LatLng) {
  return browser.newContext({
    storageState: 'e2e/.auth/state.json',
    viewport: { width: 375, height: 740 },
    geolocation: { latitude: at[0], longitude: at[1], accuracy: 8 },
    permissions: ['geolocation'],
  });
}

// Quick fixes, PR 4 (Oct 2026). Tom: "selecting GPS on the first hole doesn't
// take you to the first hole… it's hard to tell where the pin is." The map
// used to open on the first hole with no SAVED score, and the scorer's map
// button saves the hole it is on first — so from hole 1 it opened hole 2.
// Hole 1 is scored here, the scorer walked back to it, and the map opened
// from there: it must be on hole 1, with the flag standing on the green.
//
// Self-seeded: this test brings its OWN mapped course (a QA row with eighteen
// straight holes, removed in `finally`), so it runs wherever the suite runs —
// `live-rangefinder.spec.ts` needs the seeded Eagle Creek geometry, which staging and
// CI do not have. Its own file for the same reason: that fixture's
// `beforeAll` skips every test beside it when the geometry is missing.
test('gps: the map opens on the hole the scorer is ON, with a flag on the green — and Scorecard is one tap back to scoring @mobile', async ({ browser }) => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const api = await apiAs('state.json');
  const stamp = Date.now();
  const holes: HoleLine[] = Array.from({ length: 18 }, (_, i) => {
    const lat = 45.3 + i * 0.004;
    return { hole: i + 1, line: [[lat, -75.7], [lat + 0.0015, -75.6996], [lat + 0.003, -75.699]] as LatLng[] };
  });
  // PR G3: hole 1 carries a green OUTLINE — a 20 m square whose centre sits
  // 30 m past the line's end. The flag and every "to green" number stand on
  // that centre, not on the line end.
  const M_PER_DEG = (2 * Math.PI * 6371000) / 360;
  const end1 = holes[0].line[holes[0].line.length - 1];
  const greenCentre: LatLng = [end1[0] + 30 / M_PER_DEG, end1[1]];
  const gd = 10 / M_PER_DEG;
  const ring: LatLng[] = [
    [greenCentre[0] - gd, greenCentre[1] - gd], [greenCentre[0] - gd, greenCentre[1] + gd],
    [greenCentre[0] + gd, greenCentre[1] + gd], [greenCentre[0] + gd, greenCentre[1] - gd],
    [greenCentre[0] - gd, greenCentre[1] - gd],
  ];
  const yardsBetween = (a: LatLng, b: LatLng) => {
    const dLat = ((b[0] - a[0]) * Math.PI) / 180;
    const dLng = ((b[1] - a[1]) * Math.PI) / 180;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * 6371 * Math.asin(Math.sqrt(s)) * 1093.6133);
  };
  let courseId = '';
  let roundId = '';
  const ctx = await phoneContext(browser, holes[0].line[0]);
  try {
    const seeded = await admin
      .from('golf_courses')
      .insert({
        external_source: 'qa-e2e',
        external_id: `gps-${stamp}`,
        name: `QA GPS Links ${stamp}`,
        lat: holes[0].line[0][0],
        lng: holes[0].line[0][1],
        hole_geometry: { holes: holes.map(h => ({ hole: h.hole, par: 4, line: h.line })), source: 'osm', greens: [{ hole: 1, ring }] },
        hole_geometry_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    expect(seeded.error, seeded.error?.message).toBeNull();
    courseId = seeded.data!.id as string;

    const made = await api.post('/api/group-posts', {
      data: {
        type: 'golf_round',
        title: `QA GPS ${stamp}`,
        date: new Date().toISOString().split('T')[0],
        location: `QA GPS Links ${stamp}`,
        visibility: 'private',
        participant_ids: [],
        golf_data: {
          course_name: `QA GPS Links ${stamp}`,
          round_type: 'outdoor',
          holes_played: 18,
          hole_data: Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4 })),
          course_id: courseId,
        },
      },
    });
    expect(made.ok(), await readErrorBody(made)).toBe(true);
    roundId = (await made.json()).group_post.id as string;

    const cardRes = await api.get(`/api/group-posts/${roundId}/scorecard`);
    expect(cardRes.ok(), await readErrorBody(cardRes)).toBe(true);
    const rowId = (await cardRes.json()).scorecard.participants[0].participant.id as string;
    const scored = await api.post(`/api/golf/scorecards/${rowId}/scores`, { data: { scores: [{ hole_number: 1, strokes: 4 }] } });
    expect(scored.status(), await readErrorBody(scored)).toBe(201);

    const page = await ctx.newPage();
    await page.goto(`/live/${roundId}`);
    // The scorer resumes on the first unscored hole — 2 — and is walked back.
    await expect(page.getByText('Hole 2 media')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Previous', exact: true }).click();
    await expect(page.getByText('Hole 1 media')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Open course map' }).click();

    await page.locator('[aria-label="Previous hole"]').waitFor({ timeout: 30_000 });
    await expect(page.getByText(/^Hole 1\b/)).toBeVisible();
    await expect(page.locator('[data-hole-unmapped]')).toHaveCount(0);

    // The flag's pole stands ON the green dot (the end of hole 1's line).
    const flag = page.locator('.leaflet-marker-pane [data-green-flag]');
    await expect(flag).toHaveCount(1);
    const dot = await settledBox(page.locator('.leaflet-overlay-pane path[fill="#16a34a"]').first());
    const fb = (await flag.boundingBox())!;
    const dotCentre = { x: dot.x + dot.width / 2, y: dot.y + dot.height / 2 };
    expect(Math.abs(fb.x + 5 - dotCentre.x)).toBeLessThanOrEqual(4);
    expect(Math.abs(fb.y + 34 - dotCentre.y)).toBeLessThanOrEqual(4);
    // …clear of the chip and the buttons laid over the map (a hole running
    // straight up the screen used to put its green under the hole chip)…
    const onMap = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.leaflet-container'), dotCentre);
    expect(onMap, 'the green is not underneath an overlay').toBe(true);
    const chip = (await page.locator('[aria-label="Previous hole"]').locator('..').boundingBox())!;
    expect(fb.y, 'the whole flag sits below the hole chip').toBeGreaterThan(chip.y + chip.height);
    // …and not behind the distance pill either: nothing of the app is drawn
    // over the flag (its tip and its foot are both bare map).
    const pill = page.getByText(/\d+ yds to green/);
    await expect(pill).toBeVisible({ timeout: 10_000 });
    // …and the number is measured to the outline's CENTRE (30 m past the
    // line end), from the tee the fix stands on.
    const pillYds = Number((/(\d+) yds to green/.exec((await pill.textContent()) ?? '') ?? [])[1]);
    expect(Math.abs(pillYds - yardsBetween(holes[0].line[0], greenCentre))).toBeLessThanOrEqual(3);
    expect(pillYds - yardsBetween(holes[0].line[0], end1)).toBeGreaterThanOrEqual(28);
    const tipBare = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.leaflet-container'), { x: fb.x + 14, y: fb.y + 6 });
    expect(tipBare, 'the flag is not underneath the distance pill').toBe(true);
    // …inside the map, and never in the way of a tap on the green.
    expect(dotCentre.x).toBeGreaterThan(0);
    expect(dotCentre.x).toBeLessThan(375);
    expect(dotCentre.y).toBeGreaterThan(0);
    expect(dotCentre.y).toBeLessThan(740);
    await page.mouse.click(dotCentre.x, dotCentre.y);
    await expect(page.getByText(/to target · \d+ to green/)).toBeVisible({ timeout: 5_000 });

    // Stepping on moves the flag with the hole: one flag, on hole 2's green.
    await page.getByRole('button', { name: 'Next hole' }).click();
    await expect(page.getByText(/^Hole 2\b/)).toBeVisible();
    await expect(flag).toHaveCount(1);

    // ── GPS ⇄ scoring, one tap each way (Tom, Oct 2026) ──────────────────
    // "When you press scorecard from the GPS map… you have to press continue
    // scoring." Scorecard now IS score entry for someone scoring — on the
    // hole they LEFT (1), though the map has since been stepped to hole 2.
    const scorecardTab = page.getByRole('tab', { name: 'Scorecard' });
    const continueScoring = page.getByRole('button', { name: 'Continue scoring' });
    await scorecardTab.click();
    await expect(page.getByText('Hole 1 media')).toBeVisible({ timeout: 15_000 });
    await expect(continueScoring).toHaveCount(0);

    // …and the way to the map is a labelled button, not a bare icon.
    const mapButton = page.locator('[data-scorer-map]');
    await expect(mapButton).toHaveText(/Map/);
    expect((await mapButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await mapButton.click();
    await page.locator('[aria-label="Previous hole"]').waitFor({ timeout: 15_000 });
    await expect(page.getByText(/^Hole 1\b/)).toBeVisible();

    // The map's own button still scores the hole being LOOKED at.
    await page.getByRole('button', { name: 'Next hole' }).click();
    await page.getByRole('button', { name: 'Next hole' }).click();
    await page.getByRole('button', { name: 'Score hole 3' }).click();
    await expect(page.getByText('Hole 3 media')).toBeVisible({ timeout: 15_000 });

    // Score entry opened FROM the map closes back to the map…
    const closeScorer = page.getByRole('button', { name: 'Close', exact: true }).first();
    await closeScorer.click();
    await expect(page.getByText('Hole 3 media')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('[aria-label="Previous hole"]')).toBeVisible();
    // …and with no hole handed over, Scorecard resumes on the first hole with
    // no score (2).
    await scorecardTab.click();
    await expect(page.getByText('Hole 2 media')).toBeVisible({ timeout: 15_000 });

    // Closing THAT one shows the live leaderboard, Continue scoring still on
    // it — and the Scorecard tab is the same door from there.
    await closeScorer.click();
    await expect(continueScoring).toBeVisible({ timeout: 15_000 });
    await expect(scorecardTab).toHaveAttribute('aria-selected', 'true');
    await scorecardTab.click();
    await expect(page.getByText('Hole 2 media')).toBeVisible({ timeout: 15_000 });
  } finally {
    await ctx.close();
    if (roundId) await api.delete(`/api/group-posts/${roundId}?mode=delete`);
    if (courseId) await admin.from('golf_courses').delete().eq('id', courseId);
    await api.dispose();
  }
});
