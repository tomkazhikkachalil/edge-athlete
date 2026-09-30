// ── A route as an SVG path (no tiles, no Leaflet) — pure ───────────────────
// The feed card and the profile list draw the stored route_preview (encoded,
// already trimmed — the server's rule) as a small line drawing: an
// equirectangular projection around the route's centre, x scaled by
// cos(lat) so it keeps its true shape at any latitude, fitted into a w×h box
// preserving aspect (golf's hole-svg.ts, generalized to a non-square box).
// The drawing is the athlete's own GPS, not map data — no attribution.

import { decodePolyline } from './polyline';

export interface RouteSvg {
  viewBox: string;
  d: string;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function routeSvg(encoded: string | null | undefined, w = 160, h = 90, pad = 8): RouteSvg | null {
  if (!encoded) return null;
  const pts = decodePolyline(encoded);
  if (pts.length < 2) return null;
  let sLat = 0;
  for (const p of pts) sLat += p[0];
  const k = Math.cos(((sLat / pts.length) * Math.PI) / 180);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const local = pts.map(([lat, lng]) => {
    const x = lng * k;
    const y = -lat;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    return { x, y };
  });
  const spanX = Math.max(maxX - minX, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);
  const scale = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY);
  const offX = pad + ((w - 2 * pad) - spanX * scale) / 2;
  const offY = pad + ((h - 2 * pad) - spanY * scale) / 2;
  const d = local
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${r1(offX + (p.x - minX) * scale)} ${r1(offY + (p.y - minY) * scale)}`)
    .join(' ');
  return { viewBox: `0 0 ${w} ${h}`, d };
}
