import { test, expect } from '@playwright/test';
import { adminClient, E2E_TARGET } from './helpers/qa-user';

// P1 (Oct 2026). Tom: "verify holes still mapped — a check that fails if a
// known-good course loses its hole data." The catalog is production-only
// (staging holds zero golf_courses rows), so this is a PROD PROBE on the
// seven seeded courses (migration 100): every one still carries its 18-hole
// tee sheet with a yardage on every hole, and the courses whose OSM
// geometry has been PROVEN on production keep their 18 cached lines (and,
// since G2, a `greens` array). Read-only through the service role; no QA
// user, no writes. Run: `npm run test:e2e:prod -- catalog-health`.

/** The seeded COURSES (migration 100) that carry a full 18-hole tee sheet
 *  on production. Ottawa Hunt is NOT one: migration 125's multi-course
 *  split made it a club whose sheets live on its three section rows
 *  (North / South / West — nines), and its own `hole_data` is null by
 *  design. Production also holds Greensmere's two section rows. Section
 *  rows are listed, never asserted. */
const KNOWN_GOOD_SHEETS = ['augusta-national', 'eagle-creek-kanata', 'pebble-beach', 'pinehurst-no2', 'rideau-view', 'st-andrews-old'];

/** Seeded courses whose cached geometry is proven on production (the
 *  live-rangefinder probe walks Eagle Creek's hole 1). Ottawa Hunt is a
 *  27-hole club whose geometry validates to null BY DESIGN — never here. */
const KNOWN_GOOD_GEOMETRY = ['eagle-creek-kanata'];

interface SeedRow {
  external_id: string;
  name: string;
  hole_data: Array<{ number: number; par: number; yardage: Record<string, number> }> | null;
  hole_geometry: { holes?: Array<{ hole: number; line: number[][] }>; greens?: unknown } | null;
  hole_geometry_at: string | null;
}

test('catalog health: the seeded courses keep their tee sheets, and the known-good ones their hole lines', async () => {
  test.skip(E2E_TARGET !== 'prod', 'the golf catalog is production-only (staging holds no golf_courses rows)');
  const admin = adminClient();
  const { data, error } = await admin
    .from('golf_courses')
    .select('external_id, name, hole_data, hole_geometry, hole_geometry_at')
    .eq('external_source', 'seed');
  expect(error, error?.message).toBeNull();
  const rows = (data ?? []) as SeedRow[];
  const ids = rows.map(r => r.external_id);
  for (const id of KNOWN_GOOD_SHEETS) expect(ids, `${id} is seeded`).toContain(id);
  const extra = ids.filter(id => !KNOWN_GOOD_SHEETS.includes(id)).sort();
  if (extra.length) console.log(`[catalog-health] other seed rows (sections): ${extra.join(', ')}`);
  for (const r of rows.filter(x => KNOWN_GOOD_SHEETS.includes(x.external_id))) {
    expect(r.hole_data, `${r.name}: hole_data`).not.toBeNull();
    expect(r.hole_data, `${r.name}: 18 holes`).toHaveLength(18);
    expect(r.hole_data!.map(h => h.number), `${r.name}: numbered 1..18`).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    for (const h of r.hole_data!) {
      expect(h.par, `${r.name} hole ${h.number}: par`).toBeGreaterThanOrEqual(3);
      expect(Object.values(h.yardage).some(y => typeof y === 'number' && y > 0), `${r.name} hole ${h.number}: a yardage on some tee`).toBe(true);
    }
  }
  for (const id of KNOWN_GOOD_GEOMETRY) {
    const r = rows.find(x => x.external_id === id)!;
    expect(r, `${id} is seeded`).toBeTruthy();
    expect(r.hole_geometry, `${r.name}: cached geometry`).not.toBeNull();
    const holes = r.hole_geometry!.holes ?? [];
    expect(holes, `${r.name}: 18 mapped holes`).toHaveLength(18);
    expect(holes.map(h => h.hole).sort((a, b) => a - b)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    for (const h of holes) expect(h.line.length, `${r.name} hole ${h.hole}: a line`).toBeGreaterThanOrEqual(2);
    // G2: a geometry written since the greens landed carries the key (an
    // empty array when OSM has no outlines); an older cache is refetched
    // once on the next ?holes=1 — say which it is rather than fail.
    if (!Array.isArray(r.hole_geometry!.greens)) {
      console.warn(`[catalog-health] ${r.name}: geometry cached before G2 (no greens key yet; refetched on the next ?holes=1)`);
    }
  }
});
