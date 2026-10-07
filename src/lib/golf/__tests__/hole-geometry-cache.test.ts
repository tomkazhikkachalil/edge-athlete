import { describe, it, expect, vi, afterEach } from 'vitest';
import { getCourseHoleGeometry } from '../hole-geometry';
import rideauView from './fixtures/overpass-rideau-view.json';

// PR G2: the cache layer's refetch-once rule for geometries cached before
// greens existed. A fresh row WITHOUT a `greens` key is fetched again (and
// written back WITH the key, `[]` included); a fresh row with the key, or a
// fresh null, is served as-is; a refused budget or a transport failure
// stamps nothing.

const now = Date.now();
const fresh = new Date(now - 60_000).toISOString();
const holes = [{ hole: 1, par: 4, line: [[45.2, -75.68], [45.203, -75.68]] }];

function fakeAdmin(row: Record<string, unknown> | null) {
  const updates: Array<Record<string, unknown>> = [];
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'not']) b[m] = () => b;
  b.maybeSingle = async () => ({ data: row, error: null });
  b.update = (fields: Record<string, unknown>) => ({ eq: async () => { updates.push(fields); return { error: null }; } });
  return { admin: { from: () => b } as never, updates };
}

const okFetch = () => vi.fn(async () => ({ ok: true, json: async () => rideauView }));

afterEach(() => { vi.unstubAllGlobals(); });

describe('getCourseHoleGeometry — greens freshness', () => {
  it('a fresh pre-greens geometry is fetched ONCE and written back with greens', async () => {
    const fetch = okFetch();
    vi.stubGlobal('fetch', fetch);
    const { admin, updates } = fakeAdmin({ name: 'Rideau View', lat: 45.2, lng: -75.68, hole_geometry: { holes, source: 'osm' }, hole_geometry_at: fresh, club_id: null });
    const budget = vi.fn(async () => true);
    const g = await getCourseHoleGeometry(admin, 'c1', budget);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(budget).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
    expect((updates[0].hole_geometry as { greens: unknown[] }).greens).toEqual([]);
    expect(g?.greens).toEqual([]);
    expect(g?.holes).toHaveLength(18);
  });

  it('a fresh stamped geometry (greens present) is served without a fetch or a budget call', async () => {
    const fetch = okFetch();
    vi.stubGlobal('fetch', fetch);
    const stored = { holes, source: 'osm', greens: [] };
    const { admin, updates } = fakeAdmin({ name: 'X', lat: 45.2, lng: -75.68, hole_geometry: stored, hole_geometry_at: fresh, club_id: null });
    const budget = vi.fn(async () => true);
    expect(await getCourseHoleGeometry(admin, 'c1', budget)).toBe(stored);
    expect(fetch).not.toHaveBeenCalled();
    expect(budget).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('a fresh NULL geometry keeps its TTL — no fetch', async () => {
    const fetch = okFetch();
    vi.stubGlobal('fetch', fetch);
    const { admin, updates } = fakeAdmin({ name: 'X', lat: 45.2, lng: -75.68, hole_geometry: null, hole_geometry_at: fresh, club_id: null });
    expect(await getCourseHoleGeometry(admin, 'c1', async () => true)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('a refused budget or a transport failure serves the old geometry and stamps nothing', async () => {
    const stored = { holes, source: 'osm' };
    const refused = fakeAdmin({ name: 'X', lat: 45.2, lng: -75.68, hole_geometry: stored, hole_geometry_at: fresh, club_id: null });
    const fetch = okFetch();
    vi.stubGlobal('fetch', fetch);
    expect(await getCourseHoleGeometry(refused.admin, 'c1', async () => false)).toBe(stored);
    expect(fetch).not.toHaveBeenCalled();
    expect(refused.updates).toHaveLength(0);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const failed = fakeAdmin({ name: 'X', lat: 45.2, lng: -75.68, hole_geometry: stored, hole_geometry_at: fresh, club_id: null });
    expect(await getCourseHoleGeometry(failed.admin, 'c1', async () => true)).toBe(stored);
    expect(failed.updates).toHaveLength(0);
  });
});
