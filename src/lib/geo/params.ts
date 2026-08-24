// ── Location query parameters — the one parser every search route uses ──────
// docs/SEARCH.md: every search RPC takes the same location parameters, so
// every route parses them the same way. Malformed values are IGNORED, never
// 400s — a stale client must keep getting results.

export interface LocationParams {
  countryCode?: string;
  regionCode?: string;
  near?: { lat: number; lng: number };
  radiusKm?: number;
}

const MAX_RADIUS_KM = 500;

/** "45.42,-75.69" → { lat, lng }; anything else → undefined. */
export function parseNear(value: string | null | undefined): { lat: number; lng: number } | undefined {
  if (!value) return undefined;
  const parts = value.split(',').map(s => Number(s.trim()));
  if (parts.length !== 2 || !parts.every(Number.isFinite)) return undefined;
  const [lat, lng] = parts;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;
  return { lat, lng };
}

/** Reads country / region / near / radius off a URLSearchParams. Codes are
 *  upper-cased 2–3 letter tokens only (the RPCs compare on upper()). */
export function readLocationParams(searchParams: URLSearchParams): LocationParams {
  const code = (v: string | null) => {
    const s = (v ?? '').trim().toUpperCase();
    return /^[A-Z0-9]{2,3}$/.test(s) ? s : undefined;
  };
  const radiusRaw = Number(searchParams.get('radius'));
  return {
    countryCode: code(searchParams.get('country')),
    regionCode: code(searchParams.get('region')),
    near: parseNear(searchParams.get('near')),
    radiusKm: Number.isFinite(radiusRaw) && radiusRaw > 0 ? Math.min(radiusRaw, MAX_RADIUS_KM) : undefined,
  };
}

/** True when any location constraint is present — the routes use this to
 *  decide that an empty text query is a filtered browse, not "nothing typed". */
export function hasLocationFilter(p: LocationParams): boolean {
  return Boolean(p.countryCode || p.regionCode || p.near);
}

/** The RPC argument shape shared by search_golf_courses / search_people /
 *  search_clubs. Keys are OMITTED when unset so a call without location
 *  arguments still matches the older RPC signature (PostgREST resolves by
 *  the argument names it receives). */
export function rpcLocationArgs(p: LocationParams): Record<string, string | number> {
  const args: Record<string, string | number> = {};
  if (p.countryCode) args.p_country_code = p.countryCode;
  if (p.regionCode) args.p_region_code = p.regionCode;
  if (p.near) {
    args.p_near_lat = p.near.lat;
    args.p_near_lng = p.near.lng;
  }
  if (p.radiusKm) args.p_radius_km = p.radiusKm;
  return args;
}
