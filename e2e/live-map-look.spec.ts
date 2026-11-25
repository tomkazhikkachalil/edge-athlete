import { test, expect, type Page } from './helpers/test';
import { adminClient, apiAs, readErrorBody } from './helpers/qa-user';
import { cleanup } from './helpers/cleanup';
import { walkLadder } from './helpers/fit-ladder';
import { expectScorerClosed, expectScorerOnHole, mapPreview } from './helpers/score-card';

// The live round's MAP view (Tom's live-round spec, Nov 25 2026 — section D).
// Everything drawn OVER the map is restyled; nothing the map DOES changed.
// This pins the new furniture — the top bar, the glass hole plate, the two
// capsules, the bottom bar with the info key, the credit strip — and that
// each key still drives the same behaviour; then takes the view through the
// size ladder on whichever engine the project brings.
// (Layers, tracking, follow, the target and hole navigation keep their own
// specs: gps-hole-flag, live-rangefinder, gps-unmapped-course, gps-nine-picker.)

type LatLng = [number, number];

/** Measured in the page: every way the map view fails to fit, in words. */
async function mapProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const vw = window.innerWidth;
    const doc = document.documentElement;
    if (doc.scrollWidth > vw + 1) out.push(`the page scrolls sideways (${doc.scrollWidth} > ${vw})`);
    const map = document.querySelector<HTMLElement>('[data-live-map]');
    if (!map) return ['no map view'];
    const m = map.getBoundingClientRect();
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const name = (el: Element) => (el.getAttribute('aria-label') || el.getAttribute('data-map-key') || el.textContent || el.tagName).trim().slice(0, 30);
    const box = (sel: string) => {
      const el = map.querySelector(sel);
      return el && visible(el) ? { el, r: el.getBoundingClientRect() } : null;
    };
    // The furniture: inside the map, none on another.
    const parts = ['[data-map-hole-plate]', '[data-map-controls]', '[data-map-zoom]', '[data-map-bar]', '[data-map-credit]', '[data-map-notes] > *', '[data-map-footer] > *']
      .flatMap(sel => [...map.querySelectorAll(sel)].filter(visible).map(el => ({ sel, el, r: el.getBoundingClientRect() })));
    for (const p of parts) {
      if (p.r.left < m.left - 0.5 || p.r.right > m.right + 0.5) out.push(`${p.sel} leaves the map sideways (${Math.round(p.r.left)}–${Math.round(p.r.right)} in ${Math.round(m.left)}–${Math.round(m.right)})`);
      if (p.r.bottom > m.bottom + 0.5) out.push(`${p.sel} runs below the map (${Math.round(p.r.bottom)} > ${Math.round(m.bottom)})`);
    }
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i].r;
        const b = parts[j].r;
        if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) out.push(`${parts[i].sel} is on ${parts[j].sel}`);
      }
    }
    // Every key is a real target, inside the screen.
    for (const el of map.querySelectorAll('[data-map-key], [data-map-first-hole], [data-map-info-key], [data-map-score], [aria-label="Previous hole"], [aria-label="Next hole"]')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      // The plate's chevrons are 40 wide by design (32 under 360 px), 44 tall.
      const minW = el.matches('[aria-label="Previous hole"], [aria-label="Next hole"]') ? 31.5 : 43.5;
      if (r.height < 43.5 || r.width < minW) out.push(`"${name(el)}" is ${Math.round(r.width)} × ${Math.round(r.height)}`);
      if (r.left < -0.5 || r.right > vw + 0.5) out.push(`"${name(el)}" leaves the screen (${Math.round(r.left)}–${Math.round(r.right)})`);
    }
    // The plate's numbers are whole; "Score hole N" is one line.
    for (const el of map.querySelectorAll<HTMLElement>('[data-map-hole-number], [data-map-score]')) {
      if (el.scrollWidth > el.clientWidth + 1) out.push(`"${name(el)}" is cut (${el.scrollWidth} in ${el.clientWidth})`);
    }
    const score = box('[data-map-score]');
    if (score && score.r.height > 60) out.push(`"Score hole" wrapped (${Math.round(score.r.height)} px tall)`);
    return out;
  });
}

for (const tag of ['', ' @mobile']) {
  test(`the map view: the bar, the plate, the capsules, the info key, the credits; and it fits every screen${tag}`, async ({ browser }) => {
    test.setTimeout(420_000);
    const admin = adminClient();
    const api = await apiAs('state.json');
    const stamp = Date.now();
    const holes = Array.from({ length: 18 }, (_, i) => {
      const lat = 45.2905 + i * 0.0012;
      return { hole: i + 1, par: 4, line: [[lat, -75.905], [lat + 0.0012, -75.9044], [lat + 0.0026, -75.904]] as LatLng[] };
    });
    const profile = holes.map(h => ({ hole: h.hole, pts: h.line, elev: h.hole === 1 ? [100, 103, 106.4] : [100, 100, 100] }));
    const found: string[] = [];
    let courseId = '';
    let roundId = '';
    const ctx = await browser.newContext({
      storageState: 'e2e/.auth/state.json',
      viewport: { width: 390, height: 844 },
      geolocation: { latitude: holes[0].line[0][0], longitude: holes[0].line[0][1] },
      permissions: ['geolocation'],
    });
    try {
      const seeded = await admin.from('golf_courses').insert({
        external_source: 'qa-e2e', external_id: `maplook-${stamp}`, name: `QA Map Look Links ${stamp}`, lat: holes[0].line[0][0], lng: holes[0].line[0][1],
        hole_data: holes.map(h => ({ number: h.hole, par: 4, yardage: { white: 388 }, handicap: h.hole })),
        hole_geometry: { holes, source: 'osm', greens: [] }, hole_geometry_at: new Date(stamp - 60_000).toISOString(),
        hole_elevation: { holes: profile, sampled: 'line10', source: 'open-meteo' }, hole_elevation_at: new Date(stamp).toISOString(),
      }).select('id').single();
      expect(seeded.error, seeded.error?.message).toBeNull();
      courseId = seeded.data!.id as string;
      const made = await api.post('/api/group-posts', {
        data: {
          type: 'golf_round', title: `QA Map Look ${stamp}`, date: new Date().toISOString().split('T')[0], visibility: 'private', participant_ids: [],
          golf_data: { course_name: `QA Map Look Links ${stamp}`, round_type: 'outdoor', holes_played: 18, tee_color: 'white', hole_data: holes.map(h => ({ hole: h.hole, par: 4, yardage: 388, handicap: h.hole })), course_id: courseId },
        },
      });
      expect(made.ok(), await readErrorBody(made)).toBe(true);
      roundId = (await made.json()).group_post.id as string;

      const page = await ctx.newPage();
      await page.goto(`/live/${roundId}`);
      await expectScorerOnHole(page, 1, 30_000);
      await mapPreview(page).click();
      await expectScorerClosed(page);
      const map = page.locator('[data-live-map]');
      await page.locator('[aria-label="Previous hole"]').waitFor({ timeout: 30_000 });

      // ── D1: the top bar ───────────────────────────────────────────────────
      const bar = page.locator('[data-live-bar]');
      await expect(bar.locator('[data-live-back]')).toBeVisible();
      // X1: live is red, and the SAME badge as the card's.
      await expect(bar.locator('[data-live-status="live"]')).toHaveText(/live/i);
      const tabs = bar.getByRole('tablist', { name: 'Round views' });
      await expect(tabs.getByRole('tab', { name: 'Map' })).toHaveAttribute('aria-selected', 'true');
      await expect(tabs.getByRole('tab', { name: 'Scorecard' })).toHaveAttribute('aria-selected', 'false');
      expect(Math.round((await tabs.getByRole('tab', { name: 'Scorecard' }).boundingBox())!.width)).toBe(92);
      expect(Math.round((await tabs.getByRole('tab', { name: 'Map' }).boundingBox())!.width)).toBe(64);

      // ── D3: the hole plate ────────────────────────────────────────────────
      const plate = map.locator('[data-map-hole-plate]');
      await expect(plate.locator('[data-map-hole-number]')).toHaveText('1');
      // "Hole 1" is still one string for a reader.
      await expect(page.getByText(/^Hole 1\b/)).toBeVisible();
      await expect(plate.locator('[data-chip-plays-like]')).toHaveAttribute('data-plays-like-delta', '7', { timeout: 20_000 });
      expect(Math.round((await plate.locator('> div').boundingBox())!.height)).toBe(68);
      await plate.getByRole('button', { name: 'Next hole' }).click();
      await expect(plate.locator('[data-map-hole-number]')).toHaveText('2');
      await plate.getByRole('button', { name: 'Previous hole' }).click();
      await expect(plate.locator('[data-map-hole-number]')).toHaveText('1');

      // ── The capsules: our own keys, Leaflet's default controls gone ───────
      await expect(map.locator('.leaflet-control-zoom')).toHaveCount(0);
      await expect(map.locator('.leaflet-control-attribution')).toHaveCount(0);
      const key = (which: string) => map.locator(`[data-map-key="${which}"]`);
      for (const which of ['layers', 'position', 'target', 'zoom-in', 'zoom-out']) await expect(key(which)).toBeVisible();
      // Zoom keys drive the map's own zoom.
      const zoomOf = () => page.evaluate(() => {
        const tile = document.querySelector<HTMLImageElement>('[data-live-map] .leaflet-tile-pane img');
        const m = /\/tile\/(\d+)\//.exec(tile?.src ?? '') ?? /\/(\d+)\/\d+\/\d+\.png/.exec(tile?.src ?? '');
        return m ? Number(m[1]) : null;
      });
      const z0 = await zoomOf();
      expect(z0).not.toBeNull();
      await key('zoom-out').click();
      await expect.poll(zoomOf, { timeout: 15_000 }).toBe((z0 as number) - 1);
      await key('zoom-in').click();
      await expect.poll(zoomOf, { timeout: 15_000 }).toBe(z0);
      // My position: on (the round is open and location is granted) and accent while on.
      await expect(key('position')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
      await expect(map.locator('.leaflet-marker-pane [data-player-dot]')).toHaveCount(1, { timeout: 15_000 });
      await expect(map.locator('.leaflet-marker-pane [data-tee-marker="1"]')).toHaveText('1');

      // ── A11 / R7: the hints are behind the info key, not on the map ───────
      await expect(map.getByText(/Tap the map to set a target/)).toHaveCount(0);
      await expect(map.getByText(/stays on your device/)).toHaveCount(0);
      const infoKey = map.locator('[data-map-info-key]');
      await expect(infoKey).toHaveAttribute('aria-expanded', 'false');
      await infoKey.click();
      const info = map.locator('[data-map-info]');
      await expect(info).toContainText('Tap the map to set a target.');
      await expect(info).toContainText('Your position stays on your device. It is never uploaded.');
      await infoKey.click();
      await expect(info).toHaveCount(0);

      // Set target: the key says whether one is set; with none, it says how.
      await expect(key('target')).toHaveAttribute('aria-pressed', 'false');
      await key('target').click();
      await expect(info).toBeVisible();
      await infoKey.click();
      const m = (await map.locator('.leaflet-container').boundingBox())!;
      await page.mouse.click(m.x + m.width * 0.5, m.y + m.height * 0.55);
      await expect(map.locator('[data-target-pill]')).toContainText(/to target · \d+ to green/, { timeout: 15_000 });
      await expect(key('target')).toHaveAttribute('aria-pressed', 'true');
      await walkLadder(page, 'Map (a target set)', found, () => mapProblems(page));
      await key('target').click();
      await expect(map.locator('[data-target-pill]')).toHaveCount(0);

      // ── The credit: every credit and link the providers require ───────────
      const credit = map.locator('[data-map-credit]');
      await expect(credit).toHaveAttribute('data-map-credit', 'satellite');
      await expect(credit).toContainText('Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community');
      await expect(credit.locator('a[href="https://www.openstreetmap.org/copyright"]')).toHaveCount(1);
      await key('layers').click();
      await expect(credit).toHaveAttribute('data-map-credit', 'osm');
      await expect(credit).toContainText('OpenStreetMap');
      await expect(credit).toContainText('contributors');
      await expect(credit.locator('a[href="https://www.openstreetmap.org/copyright"]')).toHaveCount(1);
      await key('layers').click();
      expect(Math.round((await credit.boundingBox())!.height)).toBe(24);

      // ── The bottom bar ────────────────────────────────────────────────────
      await plate.getByRole('button', { name: 'Next hole' }).click();
      await map.locator('[data-map-first-hole]').click();
      await expect(plate.locator('[data-map-hole-number]')).toHaveText('1');
      const score = map.locator('[data-map-score]');
      await expect(score).toHaveText(/Score hole 1/);
      expect(Math.round((await score.boundingBox())!.height)).toBe(56);

      await walkLadder(page, 'Map', found, () => mapProblems(page));
      await infoKey.click();
      await walkLadder(page, 'Map (info open)', found, () => mapProblems(page));
      await infoKey.click();
      expect(found, `\n${found.join('\n')}\n`).toEqual([]);

      // "Score hole N" opens the card on the hole being looked at.
      await score.click();
      await expectScorerOnHole(page, 1, 20_000);
    } finally {
      await cleanup('live-map-look', [
        () => roundId && admin.from('group_posts').delete().eq('id', roundId),
        () => courseId && admin.from('golf_courses').delete().eq('id', courseId),
        () => api.dispose(),
        () => ctx.close(),
      ]);
    }
  });
}
