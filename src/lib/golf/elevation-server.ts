// ── The elevation cache (PR C, Oct 2026): fetch once, keep 30 days ──────────
// Open-Meteo's Elevation API, through its COMMERCIAL host only (the free host
// is for non-commercial use — Edge Athlete is a product): no OPEN_METEO_API_KEY
// → no call, the cache is served, nothing is stamped. Budgeted like every
// provider (consumeProviderBudget 'open-meteo'). The geometry path is not
// touched: this reads hole_geometry and writes only the two 254 columns.

import type { SupabaseClient } from '@supabase/supabase-js';
import { parseStoredHoleGeometry } from '@/lib/golf/hole-svg';
import {
  parseStoredElevation,
  sampleHoleLine,
  SAMPLES_PER_HOLE,
  type HoleElevation,
  type HoleElevationProfile,
  type LatLng,
} from '@/lib/golf/elevation';

export const ELEVATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const OPEN_METEO_MAX_COORDS = 100;
const OPEN_METEO_HOST = 'https://customer-api.open-meteo.com/v1/elevation';
const TIMEOUT_MS = 5000;

export const openMeteoConfigured = (): boolean => !!process.env.OPEN_METEO_API_KEY;

export interface ElevationFetch {
  /** False = transport-level failure (timeout, non-2xx, a bad body): nothing is stamped. */
  reached: boolean;
  elev: number[] | null;
}

/** Elevations for the coordinates, in order, in chunks of ≤100 per request.
 *  Any chunk failing fails the whole fetch — a half profile is no profile. */
export async function fetchElevations(coords: LatLng[]): Promise<ElevationFetch> {
  const key = process.env.OPEN_METEO_API_KEY;
  if (!key || coords.length === 0) return { reached: false, elev: null };
  const out: number[] = [];
  for (let i = 0; i < coords.length; i += OPEN_METEO_MAX_COORDS) {
    const chunk = coords.slice(i, i + OPEN_METEO_MAX_COORDS);
    const url =
      `${OPEN_METEO_HOST}?latitude=${chunk.map(c => c[0].toFixed(6)).join(',')}` +
      `&longitude=${chunk.map(c => c[1].toFixed(6)).join(',')}&apikey=${encodeURIComponent(key)}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return { reached: false, elev: null };
      const body = (await res.json()) as { elevation?: unknown };
      const elev = Array.isArray(body.elevation) ? body.elevation : null;
      if (!elev || elev.length !== chunk.length || !elev.every(e => typeof e === 'number' && Number.isFinite(e))) {
        return { reached: false, elev: null };
      }
      out.push(...(elev as number[]));
    } catch {
      return { reached: false, elev: null };
    }
  }
  return { reached: true, elev: out };
}

interface ElevationRow {
  hole_geometry: unknown;
  hole_geometry_at: string | null;
  hole_elevation: unknown;
  hole_elevation_at: string | null;
}

async function readRow(admin: SupabaseClient, courseId: string): Promise<ElevationRow | null | 'absent'> {
  const { data, error } = await admin
    .from('golf_courses')
    .select('hole_geometry, hole_geometry_at, hole_elevation, hole_elevation_at')
    .eq('id', courseId)
    .maybeSingle();
  // Pre-254 (the columns are not there yet): "no elevation", never an error.
  if (error) return (error as { code?: string }).code === '42703' ? 'absent' : null;
  return (data as ElevationRow | null) ?? null;
}

/** The cached profile only — what `?holes=1` serves beside the geometry. */
export async function readCourseHoleElevation(admin: SupabaseClient, courseId: string): Promise<HoleElevation | null> {
  const row = await readRow(admin, courseId);
  if (!row || row === 'absent') return null;
  return parseStoredElevation(row.hole_elevation);
}

/** Is the stored profile still good: attempted within the TTL and not older
 *  than the geometry it was sampled from? Exported pure for tests. */
export function elevationFresh(row: { hole_geometry_at: string | null; hole_elevation_at: string | null }, now: number = Date.now()): boolean {
  if (!row.hole_elevation_at) return false;
  const at = Date.parse(row.hole_elevation_at);
  if (Number.isNaN(at) || now - at >= ELEVATION_TTL_MS) return false;
  if (row.hole_geometry_at) {
    const geoAt = Date.parse(row.hole_geometry_at);
    if (!Number.isNaN(geoAt) && geoAt > at) return false;
  }
  return true;
}

/** The cache layer `?elevation=1` runs: the stored profile when fresh; else,
 *  with a key, geometry and budget, one sampled fetch written back (a null
 *  answer is stamped too, like 102); a transport failure stamps nothing. */
export async function getCourseHoleElevation(
  admin: SupabaseClient,
  courseId: string,
  consumeBudget: () => Promise<boolean>,
  now: number = Date.now()
): Promise<HoleElevation | null> {
  const row = await readRow(admin, courseId);
  if (!row || row === 'absent') return null;
  const stored = parseStoredElevation(row.hole_elevation);
  if (elevationFresh(row, now)) return stored;
  if (!openMeteoConfigured()) return stored;
  const geometry = parseStoredHoleGeometry(row.hole_geometry);
  if (!geometry) return stored;
  if (!(await consumeBudget())) return stored; // no stamp — retry later

  const sampled = geometry.holes.map(h => ({ hole: h.hole, pts: sampleHoleLine(h.line, SAMPLES_PER_HOLE) })).filter(h => h.pts.length >= 2);
  const coords = sampled.flatMap(h => h.pts);
  const result = await fetchElevations(coords);
  if (!result.reached || !result.elev) return stored; // transport-only failure — no stamp

  const holes: HoleElevationProfile[] = [];
  let offset = 0;
  for (const h of sampled) {
    holes.push({ hole: h.hole, pts: h.pts, elev: result.elev.slice(offset, offset + h.pts.length) });
    offset += h.pts.length;
  }
  const elevation: HoleElevation | null = holes.length ? { holes, sampled: 'line10', source: 'open-meteo' } : null;
  const { error } = await admin
    .from('golf_courses')
    .update({ hole_elevation: elevation, hole_elevation_at: new Date(now).toISOString() })
    .eq('id', courseId);
  if (error) console.error('[elevation] cache write failed:', error.message);
  return elevation;
}
