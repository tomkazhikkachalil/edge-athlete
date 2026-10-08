import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchElevations, fetchElevationsAny, fetchElevationsTerrain, getCourseHoleElevation, readCourseHoleElevation, type ElevationProviders } from '../elevation-server';

// PR C: the Open-Meteo cache layer — no key → no call; chunks of 100; a
// transport failure stamps nothing; a fresh cache spends no budget.
// T2: Terrain Tiles is the FIRST provider (free, no key); Open-Meteo only
// behind its key when the tiles fail. The cache layer takes its providers
// injected so no test touches the network or the PNG decoder.

const ok = (m: number): ElevationProviders['terrain'] => async coords => ({ reached: true, elev: coords.map(() => m) });
const down: ElevationProviders['terrain'] = async () => ({ reached: false, elev: null });

const now = Date.parse('2026-10-07T12:00:00Z');
const geometry = {
  source: 'osm',
  holes: Array.from({ length: 18 }, (_, i) => {
    const lat = 45.3 + i * 0.004;
    return { hole: i + 1, par: 4, line: [[lat, -75.7], [lat + 0.003, -75.699]] };
  }),
};

function fakeAdmin(row: Record<string, unknown> | null, selectError?: { code: string; message: string }) {
  const updates: Array<Record<string, unknown>> = [];
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) b[m] = () => b;
  b.maybeSingle = async () => ({ data: row, error: selectError ?? null });
  b.update = (fields: Record<string, unknown>) => ({ eq: async () => { updates.push(fields); return { error: null }; } });
  return { admin: { from: () => b } as never, updates };
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('fetchElevations', () => {
  it('no key → never reaches out', async () => {
    vi.stubEnv('OPEN_METEO_API_KEY', '');
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    expect(await fetchElevations([[45, -75]])).toEqual({ reached: false, elev: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('180 coordinates are two requests on the commercial host, in order', async () => {
    vi.stubEnv('OPEN_METEO_API_KEY', 'k');
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn<(url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>(async url => {
      calls.push(url);
      const n = url.split('latitude=')[1].split('&')[0].split(',').length;
      return { ok: true, json: async () => ({ elevation: Array.from({ length: n }, (_, i) => i) }) };
    }));
    const coords = Array.from({ length: 180 }, (_, i) => [45 + i * 0.001, -75] as [number, number]);
    const out = await fetchElevations(coords);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('https://customer-api.open-meteo.com/v1/elevation?latitude=');
    expect(calls[0]).toContain('apikey=k');
    expect(out.reached).toBe(true);
    expect(out.elev).toHaveLength(180);
    expect(out.elev![100]).toBe(0);
  });
  it('a failing chunk fails the whole fetch', async () => {
    vi.stubEnv('OPEN_METEO_API_KEY', 'k');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    expect(await fetchElevations([[45, -75]])).toEqual({ reached: false, elev: null });
  });
});

describe('fetchElevationsTerrain (T2)', () => {
  /** A 256×256 RGB raster whose every pixel encodes `m` metres. */
  const flat = (m: number) => async () => {
    const data = new Uint8Array(256 * 256 * 3);
    const v = m + 32768;
    for (let i = 0; i < 256 * 256; i++) { data[i * 3] = Math.floor(v / 256); data[i * 3 + 1] = v % 256; data[i * 3 + 2] = 0; }
    return { data, width: 256, height: 256, channels: 3 };
  };
  it('fetches each tile ONCE and reads every coordinate off it, in order', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(url); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; }));
    // 180 points on one hole line (one tile) + one point a few km away (a second tile).
    const coords = [...Array.from({ length: 180 }, (_, i) => [45.3 + i * 0.00001, -75.7] as [number, number]), [45.0, -75.0] as [number, number]];
    const out = await fetchElevationsTerrain(coords, flat(120));
    expect(urls).toHaveLength(2);
    expect(urls[0]).toMatch(/^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\/14\/\d+\/\d+\.png$/);
    expect(out.reached).toBe(true);
    expect(out.elev).toHaveLength(181);
    expect(out.elev!.every(e => e === 120)).toBe(true);
  });
  it('a missing tile, a bad raster or no coordinates → not reached (nothing to stamp)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) })));
    expect(await fetchElevationsTerrain([[45.3, -75.7]], flat(1))).toEqual({ reached: false, elev: null });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
    expect(await fetchElevationsTerrain([[45.3, -75.7]], async () => ({ data: new Uint8Array(3), width: 256, height: 256, channels: 3 }))).toEqual({ reached: false, elev: null });
    expect(await fetchElevationsTerrain([], flat(1))).toEqual({ reached: false, elev: null });
  });
});

describe('fetchElevationsAny — the provider order (T2)', () => {
  it('tiles first; with the tiles reached Open-Meteo is never asked, key or no key', async () => {
    vi.stubEnv('OPEN_METEO_API_KEY', 'k');
    const openMeteo = vi.fn(ok(5));
    const out = await fetchElevationsAny([[45, -75]], { terrain: ok(9), openMeteo });
    expect(out).toEqual({ reached: true, elev: [9], source: 'terrain-tiles' });
    expect(openMeteo).not.toHaveBeenCalled();
  });
  it('tiles down + a key → Open-Meteo; tiles down + no key → nothing', async () => {
    vi.stubEnv('OPEN_METEO_API_KEY', 'k');
    expect(await fetchElevationsAny([[45, -75]], { terrain: down, openMeteo: ok(5) })).toEqual({ reached: true, elev: [5], source: 'open-meteo' });
    vi.stubEnv('OPEN_METEO_API_KEY', '');
    const openMeteo = vi.fn(ok(5));
    expect(await fetchElevationsAny([[45, -75]], { terrain: down, openMeteo })).toEqual({ reached: false, elev: null, source: null });
    expect(openMeteo).not.toHaveBeenCalled();
  });
});

describe('getCourseHoleElevation', () => {
  it('a fresh cache is served without a budget call or a fetch', async () => {
    const stored = { holes: [{ hole: 1, pts: [[45, -75], [45.001, -75]], elev: [10, 12] }], sampled: 'line10', source: 'open-meteo' };
    const { admin, updates } = fakeAdmin({ hole_geometry: geometry, hole_geometry_at: new Date(now - 5000).toISOString(), hole_elevation: stored, hole_elevation_at: new Date(now - 1000).toISOString() });
    const budget = vi.fn(async () => true);
    const terrain = vi.fn(ok(1));
    const out = await getCourseHoleElevation(admin, 'c1', budget, now, { terrain, openMeteo: ok(1) });
    expect(out?.holes[0].elev).toEqual([10, 12]);
    expect(out?.source).toBe('open-meteo');
    expect(budget).not.toHaveBeenCalled();
    expect(terrain).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });
  it('no key: the tiles alone write the profile, stamped terrain-tiles (T2)', async () => {
    vi.stubEnv('OPEN_METEO_API_KEY', '');
    const openMeteo = vi.fn(ok(1));
    const { admin, updates } = fakeAdmin({ hole_geometry: geometry, hole_geometry_at: new Date(now - 5000).toISOString(), hole_elevation: null, hole_elevation_at: null });
    const out = await getCourseHoleElevation(admin, 'c1', async () => true, now, { terrain: ok(100), openMeteo });
    expect(out?.holes).toHaveLength(18);
    expect(out?.holes[17].pts).toHaveLength(10);
    expect(out?.holes[17].elev).toHaveLength(10);
    expect(out?.source).toBe('terrain-tiles');
    expect(openMeteo).not.toHaveBeenCalled();
    expect(updates).toHaveLength(1);
    expect(updates[0].hole_elevation_at).toBe(new Date(now).toISOString());
    expect((updates[0].hole_elevation as { holes: unknown[]; source: string }).source).toBe('terrain-tiles');
  });
  it('no key and the tiles down: the stale cache, nothing stamped', async () => {
    vi.stubEnv('OPEN_METEO_API_KEY', '');
    const { admin, updates } = fakeAdmin({ hole_geometry: geometry, hole_geometry_at: null, hole_elevation: null, hole_elevation_at: null });
    expect(await getCourseHoleElevation(admin, 'c1', async () => true, now, { terrain: down, openMeteo: ok(1) })).toBeNull();
    expect(updates).toEqual([]);
  });
  it('with a key and the tiles down: Open-Meteo samples 18 × 10, fetches twice, writes the profile and the stamp', async () => {
    vi.stubEnv('OPEN_METEO_API_KEY', 'k');
    const fetchMock = vi.fn<(url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>(async url => {
      const n = url.split('latitude=')[1].split('&')[0].split(',').length;
      return { ok: true, json: async () => ({ elevation: Array.from({ length: n }, () => 100) }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { admin, updates } = fakeAdmin({ hole_geometry: geometry, hole_geometry_at: new Date(now - 5000).toISOString(), hole_elevation: null, hole_elevation_at: null });
    const out = await getCourseHoleElevation(admin, 'c1', async () => true, now, { terrain: down, openMeteo: fetchElevations });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out?.holes).toHaveLength(18);
    expect(out?.holes[17].pts).toHaveLength(10);
    expect(out?.holes[17].elev).toHaveLength(10);
    expect(out?.source).toBe('open-meteo');
    expect(updates).toHaveLength(1);
    expect(updates[0].hole_elevation_at).toBe(new Date(now).toISOString());
    expect((updates[0].hole_elevation as { holes: unknown[] }).holes).toHaveLength(18);
  });
  it('a transport failure on every provider stamps nothing; a refused budget stamps nothing', async () => {
    vi.stubEnv('OPEN_METEO_API_KEY', 'k');
    const a = fakeAdmin({ hole_geometry: geometry, hole_geometry_at: null, hole_elevation: null, hole_elevation_at: null });
    expect(await getCourseHoleElevation(a.admin, 'c1', async () => true, now, { terrain: down, openMeteo: down })).toBeNull();
    expect(a.updates).toEqual([]);
    const b = fakeAdmin({ hole_geometry: geometry, hole_geometry_at: null, hole_elevation: null, hole_elevation_at: null });
    const terrain = vi.fn(ok(1));
    expect(await getCourseHoleElevation(b.admin, 'c1', async () => false, now, { terrain, openMeteo: ok(1) })).toBeNull();
    expect(terrain).not.toHaveBeenCalled();
    expect(b.updates).toEqual([]);
  });
  it('the geometry newer than the profile → refetched', async () => {
    const stale = { holes: [{ hole: 1, pts: [[45, -75], [45.001, -75]], elev: [10, 12] }], sampled: 'line10', source: 'open-meteo' };
    const { admin, updates } = fakeAdmin({ hole_geometry: geometry, hole_geometry_at: new Date(now - 100).toISOString(), hole_elevation: stale, hole_elevation_at: new Date(now - 1000).toISOString() });
    const terrain = vi.fn(ok(50));
    const out = await getCourseHoleElevation(admin, 'c1', async () => true, now, { terrain, openMeteo: ok(1) });
    expect(terrain).toHaveBeenCalled();
    expect(out?.holes[0].elev[0]).toBe(50);
    expect(out?.source).toBe('terrain-tiles');
    expect(updates).toHaveLength(1);
  });
  it('pre-254 (the columns are missing, 42703) is "no elevation", never an error', async () => {
    const { admin } = fakeAdmin(null, { code: '42703', message: 'column does not exist' });
    expect(await readCourseHoleElevation(admin, 'c1')).toBeNull();
    expect(await getCourseHoleElevation(admin, 'c1', async () => true, now)).toBeNull();
  });
});
