import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchElevations, getCourseHoleElevation, readCourseHoleElevation } from '../elevation-server';

// PR C: the Open-Meteo cache layer — no key → no call; chunks of 100; a
// transport failure stamps nothing; a fresh cache spends no budget.

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

describe('getCourseHoleElevation', () => {
  it('a fresh cache is served without a budget call or a fetch', async () => {
    vi.stubEnv('OPEN_METEO_API_KEY', 'k');
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const stored = { holes: [{ hole: 1, pts: [[45, -75], [45.001, -75]], elev: [10, 12] }], sampled: 'line10', source: 'open-meteo' };
    const { admin, updates } = fakeAdmin({ hole_geometry: geometry, hole_geometry_at: new Date(now - 5000).toISOString(), hole_elevation: stored, hole_elevation_at: new Date(now - 1000).toISOString() });
    const budget = vi.fn(async () => true);
    const out = await getCourseHoleElevation(admin, 'c1', budget, now);
    expect(out?.holes[0].elev).toEqual([10, 12]);
    expect(budget).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });
  it('no key → the stale cache, nothing fetched, nothing stamped', async () => {
    vi.stubEnv('OPEN_METEO_API_KEY', '');
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const { admin, updates } = fakeAdmin({ hole_geometry: geometry, hole_geometry_at: null, hole_elevation: null, hole_elevation_at: null });
    expect(await getCourseHoleElevation(admin, 'c1', async () => true, now)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });
  it('with a key, geometry and budget: samples 18 × 10, fetches twice, writes the profile and the stamp', async () => {
    vi.stubEnv('OPEN_METEO_API_KEY', 'k');
    const fetchMock = vi.fn<(url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>(async url => {
      const n = url.split('latitude=')[1].split('&')[0].split(',').length;
      return { ok: true, json: async () => ({ elevation: Array.from({ length: n }, () => 100) }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { admin, updates } = fakeAdmin({ hole_geometry: geometry, hole_geometry_at: new Date(now - 5000).toISOString(), hole_elevation: null, hole_elevation_at: null });
    const out = await getCourseHoleElevation(admin, 'c1', async () => true, now);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out?.holes).toHaveLength(18);
    expect(out?.holes[17].pts).toHaveLength(10);
    expect(out?.holes[17].elev).toHaveLength(10);
    expect(updates).toHaveLength(1);
    expect(updates[0].hole_elevation_at).toBe(new Date(now).toISOString());
    expect((updates[0].hole_elevation as { holes: unknown[] }).holes).toHaveLength(18);
  });
  it('a transport failure stamps nothing; a refused budget stamps nothing', async () => {
    vi.stubEnv('OPEN_METEO_API_KEY', 'k');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout'); }));
    const a = fakeAdmin({ hole_geometry: geometry, hole_geometry_at: null, hole_elevation: null, hole_elevation_at: null });
    expect(await getCourseHoleElevation(a.admin, 'c1', async () => true, now)).toBeNull();
    expect(a.updates).toEqual([]);
    const b = fakeAdmin({ hole_geometry: geometry, hole_geometry_at: null, hole_elevation: null, hole_elevation_at: null });
    expect(await getCourseHoleElevation(b.admin, 'c1', async () => false, now)).toBeNull();
    expect(b.updates).toEqual([]);
  });
  it('the geometry newer than the profile → refetched', async () => {
    vi.stubEnv('OPEN_METEO_API_KEY', 'k');
    const fetchMock = vi.fn<(url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>(async url => {
      const n = url.split('latitude=')[1].split('&')[0].split(',').length;
      return { ok: true, json: async () => ({ elevation: Array.from({ length: n }, () => 50) }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const stale = { holes: [{ hole: 1, pts: [[45, -75], [45.001, -75]], elev: [10, 12] }], sampled: 'line10', source: 'open-meteo' };
    const { admin, updates } = fakeAdmin({ hole_geometry: geometry, hole_geometry_at: new Date(now - 100).toISOString(), hole_elevation: stale, hole_elevation_at: new Date(now - 1000).toISOString() });
    const out = await getCourseHoleElevation(admin, 'c1', async () => true, now);
    expect(fetchMock).toHaveBeenCalled();
    expect(out?.holes[0].elev[0]).toBe(50);
    expect(updates).toHaveLength(1);
  });
  it('pre-254 (the columns are missing, 42703) is "no elevation", never an error', async () => {
    const { admin } = fakeAdmin(null, { code: '42703', message: 'column does not exist' });
    expect(await readCourseHoleElevation(admin, 'c1')).toBeNull();
    expect(await getCourseHoleElevation(admin, 'c1', async () => true, now)).toBeNull();
  });
});
