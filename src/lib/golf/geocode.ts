// ── Course geocoding (OSM Nominatim) ─────────────────────────────────────────
// Why this exists: the course providers' lat/lng data is demonstrably bad —
// in the first real-device pass, 3 of the 4 courses the owner had played were
// 8–22 km from their true locations ("the GPS location is a completely
// different location"). OSM carries actual golf-course polygons, so a
// name+locality geocode filtered to `type === 'golf_course'` is far more
// trustworthy than provider coords.
//
// Usage rules (Nominatim policy): server-side only, descriptive User-Agent,
// never per-keystroke — callers are the once-per-7-days hydration path
// (budgeted via rate_limit_hit like the other providers) and one-off repair
// scripts. Attribution is already satisfied: every map renders the OSM line.
//
// The accept rule is deliberately conservative: ONLY a golf_course-typed
// result counts. (Live probe: Pebble Beach's top hit is the restaurant node —
// rejected, provider coords kept, which were fine there.)

export interface GeocodePoint {
  lat: number;
  lng: number;
}

interface NominatimResult {
  lat?: string;
  lon?: string;
  type?: string;
}

/** Distance in km between two points (spherical earth is plenty here). */
export function haversineKm(a: GeocodePoint, b: GeocodePoint): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Replace stored coords when they're missing or the golf-course match is
 *  more than `thresholdKm` away (small offsets aren't worth churning). */
export function shouldReplaceCoords(
  stored: Partial<GeocodePoint> | null | undefined,
  found: GeocodePoint,
  thresholdKm = 1.5
): boolean {
  if (typeof stored?.lat !== 'number' || typeof stored?.lng !== 'number') return true;
  return haversineKm({ lat: stored.lat, lng: stored.lng }, found) > thresholdKm;
}

export interface GeocodeQuery {
  q: string;
  /** True when the query pins a city/region. Bare-name matches can be a
   *  SAME-NAME course elsewhere — the repair dry-run caught "Cottonwood
   *  Country Club" (Glendive, MT) resolving 917 km away to Salt Lake City's
   *  Cottonwood — so acceptGeocode holds them to a sanity radius. */
  localityScoped: boolean;
}

/** Query ladder for one course, most-specific first, capped at 3 so the
 *  interactive hydration path stays fast (usually 1 request).
 *  The Club↔Course swap is load-bearing: OSM's "Eagle Creek Golf Course"
 *  never matches a "…Golf Club" query. */
export function buildGeocodeQueries(
  name: string,
  city?: string | null,
  region?: string | null
): GeocodeQuery[] {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const swapped = /\bclub\b/i.test(trimmed)
    ? trimmed.replace(/\bclub\b/i, 'Course')
    : /\bcourse\b/i.test(trimmed)
      ? trimmed.replace(/\bcourse\b/i, 'Club')
      : null;
  const locality = city?.trim() || region?.trim() || null;
  const queries: GeocodeQuery[] = [];
  const push = (q: string, localityScoped: boolean) => {
    if (!queries.some(x => x.q === q)) queries.push({ q, localityScoped });
  };
  if (locality) {
    push(`${trimmed}, ${locality}`, true);
    if (swapped) push(`${swapped}, ${locality}`, true);
  }
  push(trimmed, false);
  if (swapped) push(swapped, false);
  return queries.slice(0, 3);
}

/** First golf_course-typed hit, or null. Exported for tests. */
export function pickGolfCourseResult(results: unknown): GeocodePoint | null {
  if (!Array.isArray(results)) return null;
  for (const r of results as NominatimResult[]) {
    if (r?.type !== 'golf_course') continue;
    const lat = Number(r.lat);
    const lng = Number(r.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return null;
}

export interface GeocodeMatch extends GeocodePoint {
  localityScoped: boolean;
}

/** Gate a match against what's already stored. Locality-scoped matches are
 *  trusted outright; a bare-name match is only trusted when there's nothing
 *  stored or it lands within `sanityKm` of the stored point — beyond that
 *  it's more likely a same-name course somewhere else (the Cottonwood case). */
export function acceptGeocode(
  stored: Partial<GeocodePoint> | null | undefined,
  found: GeocodeMatch,
  sanityKm = 50
): boolean {
  if (found.localityScoped) return true;
  if (typeof stored?.lat !== 'number' || typeof stored?.lng !== 'number') return true;
  return haversineKm({ lat: stored.lat, lng: stored.lng }, found) <= sanityKm;
}

const NOMINATIM_UA = 'EdgeAthlete/1.0 (https://edge-athlete.vercel.app)';

/** Geocode a course to its OSM golf_course feature. Null on no confident
 *  match or any network trouble — callers keep whatever coords they have. */
export async function geocodeGolfCourse(
  name: string,
  city?: string | null,
  region?: string | null
): Promise<GeocodeMatch | null> {
  for (const { q, localityScoped } of buildGeocodeQueries(name, city, region)) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&q=${encodeURIComponent(q)}`,
        { headers: { 'User-Agent': NOMINATIM_UA }, signal: controller.signal }
      );
      clearTimeout(timer);
      if (!res.ok) continue;
      const found = pickGolfCourseResult(await res.json());
      if (found) return { ...found, localityScoped };
    } catch {
      // Timeout/network — try the next variant; a miss is always safe.
    }
  }
  return null;
}
