// ── Elevation along a hole, and what a shot "plays like" (PR C, Oct 2026) ───
// Tom: "slope to help athletes make informed decisions on their shots". The
// course API carries no elevation; a terrain model does (Open-Meteo, 90 m
// Copernicus DEM — indicative, so every number it feeds wears "≈"). The
// profile is SAMPLED once per course along each hole's OSM line (ten points,
// tee and green included) and cached in golf_courses.hole_elevation (254).
// Pure: the server layer (elevation-server.ts) fetches and caches; the
// scorer and the map chip read `riseToGreen` + `playsLikeYards` through
// hole-detail.ts. Zero React, zero DOM.

import { haversineKm } from '@/lib/golf/geocode';

export type LatLng = [number, number];

export interface HoleElevationProfile {
  hole: number;
  /** The sampled points along the line, tee first, green last. */
  pts: LatLng[];
  /** Metres above sea level, one per point. */
  elev: number[];
}

export interface HoleElevation {
  holes: HoleElevationProfile[];
  sampled: 'line10';
  source: 'open-meteo';
}

export const SAMPLES_PER_HOLE = 10;
export const YARDS_PER_METRE = 1.0936133;

/** `n` points along a polyline by cumulative distance — the first and last
 *  points of the line are always the first and last samples. Fewer than two
 *  points → nothing to sample. */
export function sampleHoleLine(line: LatLng[], n: number = SAMPLES_PER_HOLE): LatLng[] {
  if (!Array.isArray(line) || line.length < 2 || n < 2) return [];
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const d = haversineKm({ lat: line[i - 1][0], lng: line[i - 1][1] }, { lat: line[i][0], lng: line[i][1] });
    seg.push(d);
    total += d;
  }
  if (total === 0) return [line[0], line[line.length - 1]];
  const out: LatLng[] = [];
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    let acc = 0;
    let i = 0;
    while (i < seg.length && acc + seg[i] < target) {
      acc += seg[i];
      i++;
    }
    if (i >= seg.length) {
      out.push(line[line.length - 1]);
      continue;
    }
    const t = seg[i] === 0 ? 0 : (target - acc) / seg[i];
    const a = line[i];
    const b = line[i + 1];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  out[0] = line[0];
  out[n - 1] = line[line.length - 1];
  return out;
}

export const metresToYards = (m: number): number => m * YARDS_PER_METRE;

/** The rule of thumb the apps use (CaddieHQ, Blue Tees): a shot plays about
 *  one yard longer per yard of rise, and about two thirds of a yard shorter
 *  per yard of drop. Rounded to the yard; a flat shot is unchanged. */
export function playsLikeYards(distanceYds: number, riseYds: number): number {
  if (!Number.isFinite(distanceYds)) return distanceYds;
  const rise = Number.isFinite(riseYds) ? riseYds : 0;
  return Math.round(distanceYds + (rise >= 0 ? rise : rise * (2 / 3)));
}

/** Metres the green sits ABOVE the point (positive = uphill), read at the
 *  nearest sampled point of the hole's profile. Null when the profile is
 *  empty or malformed. */
export function riseToGreen(profile: Pick<HoleElevationProfile, 'pts' | 'elev'> | null | undefined, from: LatLng): number | null {
  if (!profile || !Array.isArray(profile.pts) || !Array.isArray(profile.elev)) return null;
  if (profile.pts.length < 2 || profile.pts.length !== profile.elev.length) return null;
  let bestIdx = 0;
  let bestKm = Infinity;
  for (let i = 0; i < profile.pts.length; i++) {
    const km = haversineKm({ lat: from[0], lng: from[1] }, { lat: profile.pts[i][0], lng: profile.pts[i][1] });
    if (km < bestKm) {
      bestKm = km;
      bestIdx = i;
    }
  }
  const here = profile.elev[bestIdx];
  const green = profile.elev[profile.elev.length - 1];
  if (!Number.isFinite(here) || !Number.isFinite(green)) return null;
  return green - here;
}

/** "↑ 7 yd" / "↓ 5 yd"; null under a yard either way (not worth saying). */
export function formatRise(riseYds: number | null | undefined): string | null {
  if (riseYds == null || !Number.isFinite(riseYds)) return null;
  const r = Math.round(riseYds);
  if (Math.abs(r) < 1) return null;
  return `${r > 0 ? '↑' : '↓'} ${Math.abs(r)} yd`;
}

const isPair = (v: unknown): v is LatLng =>
  Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' && Number.isFinite(v[0]) && Number.isFinite(v[1]);

/** Validate the STORED jsonb shape (254). Anything off-shape → null; a hole
 *  whose points and elevations disagree is dropped; zero good holes → null. */
export function parseStoredElevation(raw: unknown): HoleElevation | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as { holes?: unknown; source?: unknown; sampled?: unknown };
  if (rec.source !== 'open-meteo' || !Array.isArray(rec.holes)) return null;
  const holes: HoleElevationProfile[] = [];
  for (const h of rec.holes) {
    if (!h || typeof h !== 'object') continue;
    const o = h as { hole?: unknown; pts?: unknown; elev?: unknown };
    if (typeof o.hole !== 'number' || !Number.isInteger(o.hole) || o.hole < 1 || o.hole > 36) continue;
    if (!Array.isArray(o.pts) || !Array.isArray(o.elev)) continue;
    const pts = o.pts.filter(isPair);
    const elev = o.elev.filter((e): e is number => typeof e === 'number' && Number.isFinite(e));
    if (pts.length < 2 || pts.length !== o.pts.length || elev.length !== o.elev.length || pts.length !== elev.length) continue;
    holes.push({ hole: o.hole, pts, elev });
  }
  if (holes.length === 0) return null;
  holes.sort((a, b) => a.hole - b.hole);
  return { holes, sampled: 'line10', source: 'open-meteo' };
}
