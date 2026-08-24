/**
 * Clubs — the PURE validation half (node-only vitest covers this file).
 * Parallel mirror of src/lib/leagues/validate.ts, minus sport everywhere:
 * clubs are multi-sport facilities by decision (Aug 24) — the one designed
 * divergence from leagues. The entity-agnostic pieces (PlaceValueSchema,
 * isMissingTableError) are imported from the leagues file rather than
 * copied; the rest stays explicit and greppable on purpose.
 */

import { z } from 'zod';
import { boundedText, optionalText, uuid } from '@/lib/validation';
import { PlaceValueSchema, type LeaguePlace } from '@/lib/leagues/validate';

export { PlaceValueSchema, isMissingTableError } from '@/lib/leagues/validate';
export type ClubPlace = LeaguePlace;

export const ClubCreateSchema = z.object({
  name: boundedText(120),
  description: optionalText(2000),
  ownerProfileId: uuid,
  place: PlaceValueSchema.nullable().optional(),
});
export type ClubCreateInput = z.infer<typeof ClubCreateSchema>;

/** `place: null` clears the location; omitting `place` leaves it untouched. */
export const ClubUpdateSchema = z.object({
  name: boundedText(120).optional(),
  description: optionalText(2000),
  place: PlaceValueSchema.nullable().optional(),
});
export type ClubUpdateInput = z.infer<typeof ClubUpdateSchema>;

/** Self-service request (117): the requester is ALWAYS the session user —
 *  zod strips a client-sent ownerProfileId. */
export const ClubRequestSchema = ClubCreateSchema.omit({ ownerProfileId: true });
export type ClubRequestInput = z.infer<typeof ClubRequestSchema>;

/** Admin decision. Decline REQUIRES a reason (pure, unit-tested). */
export const ClubRequestDecisionSchema = z
  .object({
    requestId: uuid,
    decision: z.enum(['approve', 'decline']),
    reason: optionalText(500),
  })
  .superRefine((val, ctx) => {
    if (val.decision === 'decline' && !val.reason) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'A reason is required to decline' });
    }
  });
export type ClubRequestDecisionInput = z.infer<typeof ClubRequestDecisionSchema>;

/** Owner-assignable roles — 'owner' is not a role PATCH (leagues precedent). */
export const ClubMemberRoleSchema = z.object({
  role: z.enum(['manager', 'member']),
});
export type ClubMemberRoleInput = z.infer<typeof ClubMemberRoleSchema>;

/** PlaceValue → the clubs location columns, NULLs when cleared (the direct
 *  admin-client write convention — same shape as placeToLeagueColumns). */
export function placeToClubColumns(
  place: ClubPlace | null | undefined
): Record<string, string | number | null> {
  if (!place) {
    return {
      place_id: null, city: null, region: null, region_code: null,
      country: null, country_code: null, lat: null, lng: null,
      location_source: null,
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
    location_source: 'user',
  };
}
