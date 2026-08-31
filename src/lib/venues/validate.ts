/**
 * Venues — the PURE validation half (node-only vitest; no framework or
 * Supabase imports; the leagues/validate.ts pattern).
 *
 * Creation is ADMIN-provisioned v1 (Tom, Aug 30): /dashboard/venues posts
 * VenueCreateSchema to /api/admin/venues; org/manager venue UX arrives with
 * phase 1's org dashboard, which is also when the owning-org columns gain a
 * writer. Facilities ride the create body (one submit, no second round
 * trip) and get their own add/delete routes for the "forgot a court" case.
 */

import { z } from 'zod';
import { boundedText, optionalText, uuid } from '@/lib/validation';
import { PlaceValueSchema, type LeaguePlace } from '@/lib/leagues/validate';

export { PlaceValueSchema, isMissingTableError } from '@/lib/leagues/validate';
export type VenuePlace = LeaguePlace;

export const FacilityCreateSchema = z.object({
  name: boundedText(120),
  kind: optionalText(40),
});
export type FacilityCreateInput = z.infer<typeof FacilityCreateSchema>;

export const VenueCreateSchema = z.object({
  name: boundedText(120),
  place: PlaceValueSchema.nullable().optional(),
  golfClubId: uuid.optional(),
  facilities: z.array(FacilityCreateSchema).max(20).optional(),
});
export type VenueCreateInput = z.infer<typeof VenueCreateSchema>;

/** PlaceValue → venues location columns (real NULLs when cleared — the
 *  placeToLeagueColumns convention; venues are admin-client writes). */
export function placeToVenueColumns(
  place: VenuePlace | null | undefined
): Record<string, string | number | null> {
  if (!place) {
    return {
      place_id: null, city: null, region: null, region_code: null,
      country: null, country_code: null, lat: null, lng: null,
    };
  }
  return {
    place_id: place.placeId,
    city: place.city,
    region: place.region,
    region_code: place.regionCode,
    country: place.country,
    country_code: place.countryCode,
    lat: place.lat,
    lng: place.lng,
  };
}
