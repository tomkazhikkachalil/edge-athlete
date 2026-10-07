// ── "Courses near me" rules (Golf near-me program PR B, Oct 2026) ────────────
// Pure: the composer and Explore read these; the route's `near=` does the
// finding. A tap on "Near me" asks the catalog for the courses within
// NEAR_RADIUS_KM; when the player is standing on one, the picker offers it
// first — "Playing at X? · 0.3 km".

import { haversineKm } from '@/lib/golf/geocode';

export const NEAR_RADIUS_KM = 50;
/** Within a short walk of the clubhouse: the offer's reach. */
export const OFFER_WITHIN_KM = 1.0;

export interface NearRow {
  id: string;
  name: string;
  lat?: number | null;
  lng?: number | null;
  /** The catalog RPC's own distance when the search was `near=` (0.1 km). */
  distanceKm?: number | null;
}

/** Kilometres from the fix: the RPC's number when it carries one, else the haversine. */
export function kmFromFix(row: NearRow, fix: { lat: number; lng: number }): number | null {
  if (typeof row.distanceKm === 'number' && Number.isFinite(row.distanceKm)) return row.distanceKm;
  if (typeof row.lat !== 'number' || typeof row.lng !== 'number') return null;
  return haversineKm(fix, { lat: row.lat, lng: row.lng });
}

/** The nearest course with coordinates within `maxKm` of the fix, or null. */
export function nearbyOffer<T extends NearRow>(rows: T[], fix: { lat: number; lng: number }, maxKm = OFFER_WITHIN_KM): { course: T; km: number } | null {
  let best: { course: T; km: number } | null = null;
  for (const row of rows) {
    const km = kmFromFix(row, fix);
    if (km === null || km > maxKm) continue;
    if (!best || km < best.km) best = { course: row, km };
  }
  return best;
}

/** "0.3 km", "12 km" — one decimal under 10, whole above. */
export function formatKm(km: number): string {
  if (!Number.isFinite(km) || km < 0) return '';
  return km < 10 ? `${(Math.round(km * 10) / 10).toFixed(1)} km` : `${Math.round(km)} km`;
}
