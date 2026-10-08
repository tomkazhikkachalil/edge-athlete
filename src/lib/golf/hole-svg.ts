// ── Hole diagrams as SVG paths (phase 6e S2) ───────────────────────────────
// The public org site has NO map tiles by rule (server-only segment, no
// Leaflet, no third-party fetches), but the catalog already caches each
// hole's OSM tee→green polyline (`golf_courses.hole_geometry`, mig 102).
// A polyline needs no tiles: project it onto a small square and draw it.
// Pure and node-tested; the (public) component just emits <svg>.
//
// Projection: equirectangular around the shape's own centre (x scaled by
// cos(lat) so a hole reads at its true aspect at any latitude), scaled
// to fit the box preserving aspect, padded so the tee/green markers stay
// inside. Good to well under a metre at hole scale — this is a diagram,
// not a rangefinder (the app's live map is).
//
// OSM data is ODbL: "© OpenStreetMap contributors" must render wherever
// these lines do (the component carries the line; readers pass `source`).

import { polylineYards, type GreenRing, type HoleGeometry, type HoleLine, type HoleSection } from './hole-geometry';

export interface ProjectedPoint {
  x: number;
  y: number;
}

export interface HoleProjection {
  /** `0 0 size size` — square, so a grid of diagrams lines up. */
  viewBox: string;
  size: number;
  /** One `M x y L x y …` path per input line, in input order. */
  paths: string[];
  /** The first point of each line (the tee marker). */
  tee: ProjectedPoint[];
  /** The last point of each line (the green marker). */
  green: ProjectedPoint[];
  /** A label anchor per line: the green, nudged toward the centre. */
  label: ProjectedPoint[];
}

const isPair = (v: unknown): v is [number, number] =>
  Array.isArray(v) &&
  v.length === 2 &&
  typeof v[0] === 'number' &&
  typeof v[1] === 'number' &&
  Math.abs(v[0]) <= 90 &&
  Math.abs(v[1]) <= 180;

const validHoles = (raw: unknown): HoleLine[] => {
  if (!Array.isArray(raw)) return [];
  const holes: HoleLine[] = [];
  for (const h of raw) {
    if (!h || typeof h !== 'object') continue;
    const o = h as { hole?: unknown; par?: unknown; line?: unknown };
    if (typeof o.hole !== 'number' || !Number.isInteger(o.hole) || o.hole < 1 || o.hole > 36) continue;
    if (!Array.isArray(o.line)) continue;
    const line = o.line.filter(isPair);
    if (line.length < 2) continue;
    holes.push({ hole: o.hole, par: typeof o.par === 'number' && Number.isInteger(o.par) ? o.par : null, line });
  }
  holes.sort((a, b) => a.hole - b.hole);
  return holes;
};

/** PR G2 / PR 3: a malformed entry is dropped, never the whole geometry;
 *  `hole: null` is an UNNUMBERED ring (greens-only). Undefined when the key
 *  is absent — the cache layer's refetch-once rule keys on absence. */
const validGreens = (raw: unknown): GreenRing[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const greens: GreenRing[] = [];
  for (const g of raw) {
    if (!g || typeof g !== 'object') continue;
    const o = g as { hole?: unknown; ring?: unknown };
    const numbered = typeof o.hole === 'number' && Number.isInteger(o.hole) && o.hole >= 1 && o.hole <= 36;
    if (!numbered && o.hole != null) continue;
    if (!Array.isArray(o.ring)) continue;
    const ring = o.ring.filter(isPair);
    if (ring.length < 3) continue;
    greens.push({ hole: numbered ? (o.hole as number) : null, ring });
  }
  return greens;
};

/** Validate the STORED jsonb shape (not the Overpass payload — that is
 *  hole-geometry.ts's parser). Anything off-shape → null; a hole with
 *  fewer than two points is dropped. `holes` may be EMPTY when the greens
 *  or the sections carry the course (sweep PR 3); nothing at all → null.
 *  Old shapes parse byte-identically. */
export function parseStoredHoleGeometry(raw: unknown): HoleGeometry | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as { holes?: unknown; source?: unknown; greens?: unknown; sections?: unknown; derived?: unknown };
  if (rec.source !== 'osm' || !Array.isArray(rec.holes)) return null;
  const holes = validHoles(rec.holes);
  const greens = validGreens(rec.greens);
  let sections: HoleSection[] | undefined;
  if (Array.isArray(rec.sections)) {
    const list: HoleSection[] = [];
    for (const s of rec.sections) {
      if (!s || typeof s !== 'object') continue;
      const o = s as { label?: unknown; holes?: unknown; greens?: unknown };
      if (typeof o.label !== 'string' || !o.label.trim()) continue;
      const sh = validHoles(o.holes);
      if (!sh.length) continue;
      const sg = validGreens(o.greens);
      list.push({ label: o.label, holes: sh, ...(sg ? { greens: sg } : {}) });
    }
    if (list.length >= 2) sections = list;
  }
  if (holes.length === 0 && !(greens && greens.length) && !sections) return null;
  const out: HoleGeometry = { holes, source: 'osm' };
  if (greens) out.greens = greens;
  if (sections) out.sections = sections;
  if (rec.derived === 'features') out.derived = 'features';
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Project one or more [lat,lng] polylines into a `size`×`size` box. */
export function projectLines(
  lines: [number, number][][],
  size = 100,
  pad = 10
): HoleProjection | null {
  const pts = lines.flat();
  if (pts.length === 0) return null;
  const lat0 = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lng0 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const local = lines.map(line => line.map(([lat, lng]) => ({ x: (lng - lng0) * k, y: -(lat - lat0) })));
  const all = local.flat();
  const minX = Math.min(...all.map(p => p.x));
  const maxX = Math.max(...all.map(p => p.x));
  const minY = Math.min(...all.map(p => p.y));
  const maxY = Math.max(...all.map(p => p.y));
  const range = Math.max(maxX - minX, maxY - minY, 1e-9);
  const scale = (size - 2 * pad) / range;
  // Centre the (aspect-preserved) shape in the box.
  const offX = pad + ((size - 2 * pad) - (maxX - minX) * scale) / 2;
  const offY = pad + ((size - 2 * pad) - (maxY - minY) * scale) / 2;
  const project = (p: { x: number; y: number }): ProjectedPoint => ({
    x: round1(offX + (p.x - minX) * scale),
    y: round1(offY + (p.y - minY) * scale),
  });
  const projected = local.map(line => line.map(project));
  const centre = { x: size / 2, y: size / 2 };
  return {
    viewBox: `0 0 ${size} ${size}`,
    size,
    paths: projected.map(line => line.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')),
    tee: projected.map(line => line[0]),
    green: projected.map(line => line[line.length - 1]),
    label: projected.map(line => {
      const g = line[line.length - 1];
      // Nudge 8 units from the green toward the box centre so the number
      // never sits on the marker or outside the box.
      const dx = centre.x - g.x;
      const dy = centre.y - g.y;
      const d = Math.hypot(dx, dy) || 1;
      return { x: round1(g.x + (dx / d) * 8), y: round1(g.y + (dy / d) * 8) };
    }),
  };
}

export function holeDiagram(hole: HoleLine, size = 100, pad = 10): HoleProjection | null {
  return projectLines([hole.line], size, pad);
}

/** The hole's diagram with ONE extra point (the player) projected in the
 *  same frame — the scorer's thumbnail (PR D). `player` is null when the
 *  point lands outside the box (standing on another hole, or on the couch).
 *  The frame is fixed by the LINE alone, so the diagram never shifts as the
 *  player moves. */
export function holeDiagramWithPoint(
  hole: HoleLine,
  point: [number, number] | null,
  size = 100,
  pad = 10
): (HoleProjection & { player: ProjectedPoint | null }) | null {
  const base = projectLines([hole.line], size, pad);
  if (!base) return null;
  if (!point || !isPair(point)) return { ...base, player: null };
  // Re-project the point through the line's own frame: the same maths as
  // projectLines, with the line + the point, keeping the line's bounds.
  const pts = hole.line;
  const lat0 = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lng0 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const local = pts.map(([lat, lng]) => ({ x: (lng - lng0) * k, y: -(lat - lat0) }));
  const minX = Math.min(...local.map(p => p.x));
  const maxX = Math.max(...local.map(p => p.x));
  const minY = Math.min(...local.map(p => p.y));
  const maxY = Math.max(...local.map(p => p.y));
  const range = Math.max(maxX - minX, maxY - minY, 1e-9);
  const scale = (size - 2 * pad) / range;
  const offX = pad + ((size - 2 * pad) - (maxX - minX) * scale) / 2;
  const offY = pad + ((size - 2 * pad) - (maxY - minY) * scale) / 2;
  const p = { x: (point[1] - lng0) * k, y: -(point[0] - lat0) };
  const player = { x: round1(offX + (p.x - minX) * scale), y: round1(offY + (p.y - minY) * scale) };
  const inside = player.x >= 0 && player.x <= size && player.y >= 0 && player.y <= size;
  return { ...base, player: inside ? player : null };
}

export function courseOverview(holes: HoleLine[], size = 200, pad = 12): HoleProjection | null {
  return projectLines(holes.map(h => h.line), size, pad);
}

/** "≈ 410 yards" — the drawn length (follows the dogleg), never the card. */
export function holeYards(hole: HoleLine): number | null {
  return polylineYards(hole.line);
}
