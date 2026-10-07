import { test, expect } from '@playwright/test';
import { adminClient, apiAs, readErrorBody } from './helpers/qa-user';

// PR C (Oct 2026): `?holes=1` answers the geometry, the CACHED elevation
// profile and the row's tee sheet in one call; `?elevation=1` is the
// computing door and, with no Open-Meteo key on the deployment, serves the
// cache. Self-seeded course (the catalog is production-only on staging).

test('course API: holes=1 carries the elevation profile and the tee sheet; elevation=1 serves the cache without a key', async () => {
  const admin = adminClient();
  const api = await apiAs('state.json');
  const stamp = Date.now();
  const holes = Array.from({ length: 18 }, (_, i) => {
    const lat = 61.3 + i * 0.004;
    return { hole: i + 1, par: 4, line: [[lat, -30.5], [lat + 0.003, -30.499]] };
  });
  const profile = holes.map(h => ({ hole: h.hole, pts: [h.line[0], h.line[1]], elev: [100, h.hole === 1 ? 106.4 : 100] }));
  let courseId = '';
  try {
    const seeded = await admin
      .from('golf_courses')
      .insert({
        external_source: 'qa-e2e',
        external_id: `elev-${stamp}`,
        name: `QA Elevation Links ${stamp}`,
        lat: holes[0].line[0][0],
        lng: holes[0].line[0][1],
        hole_data: holes.map(h => ({ number: h.hole, par: 4, yardage: { white: 388, blue: 412 }, handicap: h.hole })),
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

    const res = await api.get(`/api/golf/courses?id=${courseId}&holes=1`);
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    const body = (await res.json()) as {
      geometry: { holes: unknown[] } | null;
      elevation: { holes: Array<{ hole: number; elev: number[] }> } | null;
      sheet: { holes: Array<{ number: number; handicap: number; yardage: Record<string, number> }>; courseRating: Record<string, number>; slopeRating: Record<string, number> } | null;
    };
    expect(body.geometry?.holes).toHaveLength(18);
    expect(body.elevation?.holes).toHaveLength(18);
    expect(body.elevation?.holes[0]).toMatchObject({ hole: 1, elev: [100, 106.4] });
    expect(body.sheet?.holes).toHaveLength(18);
    expect(body.sheet?.holes[10]).toMatchObject({ number: 11, handicap: 11, yardage: { white: 388, blue: 412 } });
    expect(body.sheet?.courseRating).toEqual({ white: 70.1, blue: 71.9 });
    expect(body.sheet?.slopeRating.blue).toBe(133);

    // The computing door with no key on the deployment: the fresh cache, unchanged.
    const compute = await api.get(`/api/golf/courses?id=${courseId}&elevation=1`);
    expect(compute.ok(), await readErrorBody(compute)).toBe(true);
    expect(((await compute.json()) as { elevation: { holes: unknown[] } | null }).elevation?.holes).toHaveLength(18);
    const after = await admin.from('golf_courses').select('hole_elevation_at').eq('id', courseId).single();
    expect(Date.parse(after.data?.hole_elevation_at as string)).toBe(stamp);
  } finally {
    if (courseId) await admin.from('golf_courses').delete().eq('id', courseId);
    await api.dispose();
  }
});
