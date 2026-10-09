/**
 * The route map's FRAME (Oct 9 2026) — a framed picture of the route, not a
 * navigation tool. Zero imports; the map component and the tests read it.
 *
 * Tom's spec: pinch to zoom in for detail or out to the whole route, but the
 * map never leaves the area around it. The rules here are pure numbers; the
 * map applies them (Leaflet `maxBounds` + `maxBoundsViscosity: 1`, the
 * minimum zoom at which the padded box fills the container, a maximum near
 * street level, no zoom control, a "Fit route" button).
 *
 * Computed on the CLIENT from the stream the viewer was GIVEN, never stored:
 * a viewer's stream is already trimmed 200 m at both ends by the server
 * (visibility.ts), so a box stored from the owner's full route would leak
 * the trimmed ends' extent to every viewer. Recomputing over ≤ 2,000 points
 * is microseconds.
 */

export interface GeoBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export const FRAME = {
  /** The padding around the route's box, as a fraction of its span (the spec's 20–30 %). */
  padRatio: 0.25,
  /** Street detail, not building level. */
  maxZoom: 17,
  /** The default framing's pixel padding inside the container. */
  fitPaddingPx: 24,
  /** A tiny route (a 200 m loop) still gets a box this wide, so there is room to pinch. */
  minSpanM: 400,
} as const;

const M_PER_DEG_LAT = 111_320;

/** The box around every FIXED point (nulls — a trimmed end, a lost fix — are skipped); null under two points. */
export function routeBounds(lat: readonly (number | null | undefined)[], lng: readonly (number | null | undefined)[]): GeoBounds | null {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  let n = 0;
  for (let i = 0; i < Math.min(lat.length, lng.length); i++) {
    const a = lat[i];
    const b = lng[i];
    if (a === null || b === null || a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    n += 1;
    if (a < south) south = a;
    if (a > north) north = a;
    if (b < west) west = b;
    if (b > east) east = b;
  }
  return n >= 2 ? { south, west, north, east } : null;
}

/**
 * The padded box: each side grows by `ratio` of the span, and a span under
 * `minSpanM` is widened to it around the centre (converted at the box's own
 * latitude, so a northern loop is not squashed). Latitude is clamped to the
 * Web Mercator range; longitude is left alone (a route never crosses the
 * antimeridian in practice, and Leaflet accepts it if one does).
 */
export function padBounds(b: GeoBounds, ratio: number = FRAME.padRatio, minSpanM: number = FRAME.minSpanM): GeoBounds {
  const midLat = (b.south + b.north) / 2;
  const midLng = (b.west + b.east) / 2;
  const mPerDegLng = M_PER_DEG_LAT * Math.max(0.01, Math.cos((midLat * Math.PI) / 180));
  const minLatSpan = minSpanM / M_PER_DEG_LAT;
  const minLngSpan = minSpanM / mPerDegLng;
  const latSpan = Math.max(b.north - b.south, minLatSpan);
  const lngSpan = Math.max(b.east - b.west, minLngSpan);
  const halfLat = (latSpan * (1 + 2 * ratio)) / 2;
  const halfLng = (lngSpan * (1 + 2 * ratio)) / 2;
  return {
    south: Math.max(-85.05, midLat - halfLat),
    north: Math.min(85.05, midLat + halfLat),
    west: midLng - halfLng,
    east: midLng + halfLng,
  };
}

/** Is a point inside the box? (the e2e's "the camera stayed in the frame" check) */
export function containsPoint(b: GeoBounds, lat: number, lng: number): boolean {
  return lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
}
