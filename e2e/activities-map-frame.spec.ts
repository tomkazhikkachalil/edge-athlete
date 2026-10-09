import { test, expect, type Page } from '@playwright/test';
import { adminClient, apiAs, loadQaUser } from './helpers/qa-user';
import { toWire } from '../src/lib/activities/wire';
import { line } from '../src/lib/activities/__tests__/fixtures';
import { containsPoint, FRAME } from '../src/lib/activities/route-frame';

// The route map is a FRAMED picture (Oct 9 2026, route-frame.ts): no zoom
// control, the camera stops at the padded box, zooming out stops with the
// whole route visible, zooming in stops at street level, "Fit route" restores
// the default framing, reduced motion turns the animations off, and under
// Save-Data the page shows the route's line drawing until asked for the map.

const T0 = Date.UTC(2026, 9, 3, 9, 0, 0);
const REC = '7d4f9e2a-1b3c-4d5e-8f6a-9b0c1d2e3f51';

function liveWire() {
  const w = toWire({ format: 'live', type: 'walk', name: 'Frame loop', points: line(600, { t0: T0, stepM: 1.4, stepS: 1, climbPerStep: 0.02 }), device: {}, tzOffsetMin: null }, 'America/Toronto');
  return { ...w, recordingId: REC };
}

interface Camera {
  zoom: number;
  min: number;
  max: number;
  center: [number, number];
  bounds: { south: number; west: number; north: number; east: number };
}

async function camera(page: Page): Promise<Camera> {
  const d = await page.locator('[data-activity-map]').evaluate(el => ({ ...(el as HTMLElement).dataset }));
  const [lat, lng] = (d.mapCenter ?? '0,0').split(',').map(Number);
  const [south, west, north, east] = (d.mapBounds ?? '0,0,0,0').split(',').map(Number);
  return { zoom: Number(d.mapZoom), min: Number(d.mapMinZoom), max: Number(d.mapMaxZoom), center: [lat, lng], bounds: { south, west, north, east } };
}

test('the route map is a framed picture: no free pan, bounded zoom, Fit route, reduced motion, Save-Data @mobile', async ({ page, browserName }) => {
  test.setTimeout(180_000);
  const user = loadQaUser('user.json');
  const admin = adminClient();
  const api = await apiAs('state.json');
  await admin.from('activities').delete().eq('profile_id', user.id).eq('source', 'live');
  let id: string | null = null;
  try {
    const created = await api.post('/api/activities', { data: { activity: liveWire() } });
    expect(created.status(), await created.text()).toBe(201);
    id = (await created.json()).id as string;

    await page.goto(`/activities/${id}`);
    const map = page.locator('[data-activity-map]');
    await expect(map).toBeVisible({ timeout: 20_000 });
    await expect(map).toHaveAttribute('data-map-zoom', /\d/, { timeout: 20_000 });

    // No chrome: no zoom control; the Fit button instead.
    await expect(page.locator('.leaflet-control-zoom')).toHaveCount(0);
    await expect(page.locator('[data-route-fit]')).toBeVisible();

    // The baseline is the default framing at the container's SETTLED size:
    // Fit route once, then wait for two identical readings (WebKit's first
    // fit can land one level out until the resize observer's first callback).
    await page.locator('[data-route-fit]').click();
    let start = await camera(page);
    await expect.poll(async () => {
      const again = await camera(page);
      const same = again.zoom === start.zoom && again.center[0] === start.center[0] && again.center[1] === start.center[1];
      start = again;
      return same;
    }, { timeout: 10_000, intervals: [250, 250, 500, 500, 1000] }).toBe(true);
    // The default framing sits inside the frame, within the zoom window.
    expect(start.max).toBe(FRAME.maxZoom);
    expect(start.min).toBeGreaterThan(0);
    expect(start.zoom).toBeGreaterThanOrEqual(start.min);
    expect(start.zoom).toBeLessThanOrEqual(start.max);
    expect(containsPoint(start.bounds, start.center[0], start.center[1])).toBe(true);

    // Drag a long way toward another city: the camera stops at the padded edge.
    const box = (await map.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 1500, cy + 1500, { steps: 25 });
    await page.mouse.up();
    await expect.poll(async () => {
      const c = await camera(page);
      return containsPoint(c.bounds, c.center[0], c.center[1]);
    }, { timeout: 10_000 }).toBe(true);

    // Zoom in (double-click): street detail, never past the maximum.
    await page.mouse.dblclick(cx, cy);
    await page.mouse.dblclick(cx, cy);
    await expect.poll(async () => (await camera(page)).zoom, { timeout: 10_000 }).toBeGreaterThan(start.zoom);
    expect((await camera(page)).zoom).toBeLessThanOrEqual(FRAME.maxZoom);

    // Fit route: the default framing again.
    await page.locator('[data-route-fit]').click();
    await expect.poll(async () => (await camera(page)).zoom, { timeout: 10_000 }).toBe(start.zoom);
    const refit = await camera(page);
    expect(Math.abs(refit.center[0] - start.center[0])).toBeLessThan(1e-3);
    expect(Math.abs(refit.center[1] - start.center[1])).toBeLessThan(1e-3);

    // Pinch out (Chromium's synthetic gesture; WebKit has none here): the
    // zoom never falls below the minimum — the whole route, no wider.
    if (browserName === 'chromium') {
      const cdp = await page.context().newCDPSession(page);
      for (let i = 0; i < 4; i++) {
        await cdp.send('Input.synthesizePinchGesture', { x: cx, y: cy, scaleFactor: 0.3, relativeSpeed: 800 });
        await page.waitForTimeout(300);
      }
      await cdp.detach();
      const out = await camera(page);
      expect(out.zoom).toBeGreaterThanOrEqual(out.min);
      expect(out.zoom).toBeLessThan(start.zoom + 0.01); // it did zoom out from the detail view
      expect(containsPoint(out.bounds, out.center[0], out.center[1])).toBe(true);
    }

    // Reduced motion: the map says so.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await expect(map).toHaveAttribute('data-map-animate', 'false', { timeout: 20_000 });

    // Save-Data: the line drawing first; the map on request.
    const saver = await page.context().newPage();
    await saver.addInitScript(() => {
      Object.defineProperty(navigator, 'connection', { configurable: true, get: () => ({ saveData: true }) });
    });
    await saver.goto(`/activities/${id}`);
    await expect(saver.locator('[data-route-static]')).toBeVisible({ timeout: 20_000 });
    await expect(saver.locator('[data-route-static] svg[aria-label="Route"]')).toBeVisible();
    await expect(saver.locator('.leaflet-container')).toHaveCount(0);
    await saver.locator('[data-route-show-map]').click();
    await expect(saver.locator('[data-activity-map]')).toBeVisible({ timeout: 20_000 });
    await saver.close();
  } finally {
    if (id) await api.delete(`/api/activities/${id}`).catch(() => undefined);
    await api.dispose();
  }
});
