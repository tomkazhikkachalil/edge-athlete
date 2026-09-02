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

// ── Org-manager venue shapes (phase 6b A1) ──────────────────────────────────
// The owning-org column comes from the ROUTE (side + id), never the body,
// and the golf link is a catalog COURSE pick (any golf_courses row): the
// server splits it into golf_club_id (row has club_id → the whole facility)
// or golf_course_id (single-course facility, which 125 never gives a
// golf_clubs row). golfClubId is deliberately absent from these shapes.

export const OrgVenueCreateSchema = z.object({
  name: boundedText(120),
  place: PlaceValueSchema.nullable().optional(),
  golfCourseId: uuid.optional(),
  facilities: z.array(FacilityCreateSchema).max(20).optional(),
});
export type OrgVenueCreateInput = z.infer<typeof OrgVenueCreateSchema>;

/** PATCH: every key optional; `golfCourseId: null` unlinks; `place: null`
 *  clears the location. An empty body is rejected (nothing to update). */
export const OrgVenuePatchSchema = z
  .object({
    name: boundedText(120).optional(),
    place: PlaceValueSchema.nullable().optional(),
    golfCourseId: uuid.nullable().optional(),
  })
  .refine(v => v.name !== undefined || v.place !== undefined || v.golfCourseId !== undefined, {
    message: 'Nothing to update',
  });
export type OrgVenuePatchInput = z.infer<typeof OrgVenuePatchSchema>;

/** Which venue column a catalog pick lands in: a row with club_id links the
 *  CLUB (all its sections show), a lone course links the COURSE. Pure. */
export function golfLinkColumns(
  row: { id: string; club_id?: string | null } | null
): { golf_club_id: string | null; golf_course_id: string | null } {
  if (!row) return { golf_club_id: null, golf_course_id: null };
  return row.club_id
    ? { golf_club_id: row.club_id, golf_course_id: null }
    : { golf_club_id: null, golf_course_id: row.id };
}

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
