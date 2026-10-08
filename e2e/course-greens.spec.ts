import { test, expect } from '@playwright/test';
import { adminClient, apiAs, readErrorBody } from './helpers/qa-user';

// PR G2 (Oct 2026): a green outline stored in `hole_geometry.greens` rides
// `?holes=1` unchanged, and a geometry stamped WITH the key (even empty) is
// served from the cache — no Overpass refetch, `hole_geometry_at` untouched.
// Self-seeded course (the catalog is production-only on staging); the fake
// coordinates sit mid-Atlantic so a refetch, if one ever fired, would be
// visible as a null overwrite.

test('course API: holes=1 carries the green outlines; a stamped geometry is never refetched', async () => {
  const admin = adminClient();
  const api = await apiAs('state.json');
  const stamp = Date.now();
  const holes = Array.from({ length: 18 }, (_, i) => {
    const lat = 61.3 + i * 0.004;
    return { hole: i + 1, par: 4, line: [[lat, -30.5], [lat + 0.003, -30.499]] };
  });
  const [gLat, gLng] = holes[0].line[1];
  const d = 0.0001;
  const ring = [[gLat - d, gLng - d], [gLat - d, gLng + d], [gLat + d, gLng + d], [gLat + d, gLng - d], [gLat - d, gLng - d]];
  const stampedAt = new Date(stamp - 60_000).toISOString();
  let courseId = '';
  try {
    const seeded = await admin
      .from('golf_courses')
      .insert({
        external_source: 'qa-e2e',
        external_id: `greens-${stamp}`,
        name: `QA Greens Links ${stamp}`,
        lat: holes[0].line[0][0],
        lng: holes[0].line[0][1],
        hole_geometry: { holes, source: 'osm', greens: [{ hole: 1, ring }] },
        hole_geometry_at: stampedAt,
      })
      .select('id')
      .single();
    expect(seeded.error, seeded.error?.message).toBeNull();
    courseId = seeded.data!.id as string;

    const res = await api.get(`/api/golf/courses?id=${courseId}&holes=1`);
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    const body = (await res.json()) as { geometry: { holes: unknown[]; greens?: Array<{ hole: number; ring: number[][] }> } | null };
    expect(body.geometry?.holes).toHaveLength(18);
    expect(body.geometry?.greens).toHaveLength(1);
    expect(body.geometry?.greens?.[0]).toMatchObject({ hole: 1 });
    expect(body.geometry?.greens?.[0].ring).toHaveLength(5);

    const after = await admin.from('golf_courses').select('hole_geometry_at').eq('id', courseId).single();
    expect(Date.parse(after.data?.hole_geometry_at as string)).toBe(Date.parse(stampedAt));
  } finally {
    if (courseId) await admin.from('golf_courses').delete().eq('id', courseId);
    await api.dispose();
  }
});
