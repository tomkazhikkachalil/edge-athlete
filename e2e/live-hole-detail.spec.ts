import { test, expect, type Browser } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';
import { fitsViewportWidth } from './helpers/layout';

// Hole-detail program PR E (Oct 2026): the scorer's hole header — par, HCP
// and the tee's yardage with the other tees one tap away; the distance to
// the green and what it plays like (from the map's GPS fix, published up);
// the running to-par and the group's scores on the hole; the SVG thumbnail
// that opens the map on the hole. Self-seeded course (geometry, a two-tee
// sheet with stroke indexes and ratings, an elevation profile rising 6.4 m
// on hole 1 = 7 yd) — staging holds no catalog.

type LatLng = [number, number];

async function phoneContext(browser: Browser, at: LatLng, viewport = { width: 375, height: 740 }) {
  return browser.newContext({
    storageState: 'e2e/.auth/state.json',
    viewport,
    geolocation: { latitude: at[0], longitude: at[1] },
    permissions: ['geolocation'],
  });
}

test('live hole detail: the header facts, plays-like from the shared fix, the tee sheet, the thumbnail, the group line @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const bravo = loadQaUser('user-b.json');
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  const stamp = Date.now();
  const holes = Array.from({ length: 18 }, (_, i) => {
    const lat = 45.3 + i * 0.004;
    return { hole: i + 1, par: 4, line: [[lat, -75.7], [lat + 0.0015, -75.6996], [lat + 0.003, -75.699]] as LatLng[] };
  });
  // The profile: three samples per hole (tee, mid, green); hole 1 climbs 6.4 m.
  const profile = holes.map(h => ({ hole: h.hole, pts: h.line, elev: h.hole === 1 ? [100, 103, 106.4] : [100, 100, 100] }));
  let courseId = '';
  let roundId = '';
  const ctx = await phoneContext(browser, holes[0].line[0]);
  try {
    const seeded = await admin
      .from('golf_courses')
      .insert({
        external_source: 'qa-e2e',
        external_id: `detail-${stamp}`,
        name: `QA Detail Links ${stamp}`,
        lat: holes[0].line[0][0],
        lng: holes[0].line[0][1],
        hole_data: holes.map(h => ({ number: h.hole, par: 4, yardage: { white: 388, blue: 412 }, handicap: ((h.hole * 7) % 18) + 1 })),
        course_rating: { white: 70.1, blue: 71.9 },
        slope_rating: { white: 125, blue: 133 },
        hole_geometry: { holes, source: 'osm' },
        hole_geometry_at: new Date(stamp - 60_000).toISOString(),
        hole_elevation: { holes: profile, sampled: 'line10', source: 'open-meteo' },
        hole_elevation_at: new Date(stamp).toISOString(),
      })
      .select('id')
      .single();
    expect(seeded.error, seeded.error?.message).toBeNull();
    courseId = seeded.data!.id as string;
    const hcp1 = ((1 * 7) % 18) + 1; // 8

    const made = await apiA.post('/api/group-posts', {
      data: {
        type: 'golf_round',
        title: `QA Detail ${stamp}`,
        date: new Date().toISOString().split('T')[0],
        visibility: 'private',
        participant_ids: [bravo.id],
        golf_data: {
          course_name: `QA Detail Links ${stamp}`,
          round_type: 'outdoor',
          holes_played: 18,
          tee_color: 'white',
          hole_data: holes.map(h => ({ hole: h.hole, par: 4, yardage: 388, handicap: ((h.hole * 7) % 18) + 1 })),
          course_id: courseId,
        },
      },
    });
    expect(made.ok(), await readErrorBody(made)).toBe(true);
    roundId = (await made.json()).group_post.id as string;
    const card = (await (await apiA.get(`/api/group-posts/${roundId}/scorecard`)).json()).scorecard as {
      participants: Array<{ participant: { id: string; profile_id: string } }>;
    };
    const rowB = card.participants.find(p => p.participant.profile_id === bravo.id)!.participant.id;

    const page = await ctx.newPage();
    await page.goto(`/live/${roundId}`);
    await expect(page.getByText('Hole 1 media')).toBeVisible({ timeout: 30_000 });

    // Row B: the facts for hole 1 on the white tee.
    const facts = page.locator('[data-hole-facts]');
    await expect(facts).toContainText('Par 4');
    await expect(facts).toContainText(`HCP ${hcp1}`);
    await expect(facts).toContainText('388 yds');
    await expect(facts).toContainText('White');

    // Row C: from the map's fix (the tee), the distance to the green and the
    // plays-like, 7 yards longer — the fix reached the scorer through the page.
    const live = page.locator('[data-hole-plays-like]');
    await expect(live).toHaveAttribute('data-hole-plays-like', 'gps', { timeout: 20_000 });
    const text = (await live.textContent()) ?? '';
    const m = /(\d+) yds to green · plays like ≈(\d+) \(↑ (\d+) yd\)/.exec(text);
    expect(m, text).not.toBeNull();
    const toGreen = Number(m![1]);
    const playsLike = Number(m![2]);
    expect(Number(m![3])).toBe(7);
    expect(playsLike).toBe(toGreen + 7);
    expect(toGreen).toBeGreaterThan(300);
    // Walk up the hole: the number drops with the fix.
    await ctx.setGeolocation({ latitude: holes[0].line[1][0], longitude: holes[0].line[1][1] });
    await expect.poll(async () => Number((/(\d+) yds to green/.exec((await live.textContent()) ?? '') ?? [])[1]), { timeout: 15_000 }).toBeLessThan(toGreen - 100);

    // The tee sheet: inline, both tees with their ratings, the tee in play first.
    await page.locator('[data-hole-tee-toggle]').click();
    const tees = page.locator('[data-hole-tees]');
    await expect(tees).toBeVisible();
    await expect(tees.locator('li').first()).toContainText('White');
    await expect(tees.locator('li').first()).toContainText('388 yds');
    await expect(tees.locator('li').first()).toContainText('70.1 / 125');
    await expect(tees.locator('li').nth(1)).toContainText('Blue');
    await expect(tees.locator('li').nth(1)).toContainText('412 yds · 71.9 / 133');
    expect(await fitsViewportWidth(page)).toBe(true);
    await page.locator('[data-hole-tee-toggle]').click();
    await expect(tees).toHaveCount(0);

    // The thumbnail opens the map on hole 1; Scorecard comes straight back.
    await page.locator('[data-hole-thumb]').click();
    await page.locator('[aria-label="Previous hole"]').waitFor({ timeout: 30_000 });
    await expect(page.getByText(/^Hole 1\b/)).toBeVisible();
    await page.getByRole('tab', { name: 'Scorecard' }).click();
    await expect(page.getByText('Hole 1 media')).toBeVisible({ timeout: 15_000 });

    // Bravo scores hole 2; Alpha saves hole 1 (par) and moves on: row D says
    // "You E thru 1 · Edge 5" (the switcher's first-name rule).
    const scoredB = await apiB.post(`/api/golf/scorecards/${rowB}/scores`, { data: { scores: [{ hole_number: 2, strokes: 5 }] } });
    expect(scoredB.status(), await readErrorBody(scoredB)).toBe(201);
    // Typing a digit on the wheel commits it (the quick-entry contract): par.
    const strokes = page.getByRole('spinbutton', { name: 'Strokes' });
    await strokes.focus();
    await strokes.press('4');
    await expect(strokes).toHaveAttribute('aria-valuenow', '4');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText('Hole 2 media')).toBeVisible({ timeout: 15_000 });
    const group = page.locator('[data-hole-group]');
    await expect(group).toContainText('You', { timeout: 20_000 });
    await expect(group).toContainText('thru 1');
    await expect(group).toContainText(/Edge\s+5/);
    await expect(page.locator('[data-scorer-to-par]')).toHaveText('E');

    // 320 px: nothing overflows with the header in place.
    await page.setViewportSize({ width: 320, height: 568 });
    expect(await fitsViewportWidth(page)).toBe(true);
  } finally {
    await ctx.close();
    if (roundId) await apiA.delete(`/api/group-posts/${roundId}?mode=delete`);
    if (courseId) await admin.from('golf_courses').delete().eq('id', courseId);
    await apiA.dispose();
    await apiB.dispose();
  }
});
