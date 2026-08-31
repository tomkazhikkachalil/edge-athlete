/**
 * Leagues — the PURE validation half (node-only vitest covers this file; no
 * framework or Supabase imports).
 *
 * Creation is admin-provisioned (Tom, Aug 24): the dashboard posts
 * LeagueCreateSchema to /api/admin/leagues; the owner (or a manager) edits
 * with LeagueUpdateSchema via /api/leagues/[id]. sport_key membership in
 * FEATURE_SPORTS is checked in the ROUTE, not here — importing the sports
 * registry from a lib that copy.ts-adjacent code might touch is how the
 * import-cycle class of bug starts, so this file stays registry-free.
 */

import { z } from 'zod';
import { boundedText, optionalText, uuid } from '@/lib/validation';

/** Mirrors PlacePicker's PlaceValue — the structured pick. */
export const PlaceValueSchema = z.object({
  placeId: uuid,
  city: z.string().trim().min(1),
  region: z.string().nullable(),
  regionCode: z.string().nullable(),
  country: z.string().trim().min(1),
  countryCode: z.string().trim().min(1),
  lat: z.number(),
  lng: z.number(),
  label: z.string(),
});
export type LeaguePlace = z.infer<typeof PlaceValueSchema>;

export const LeagueCreateSchema = z.object({
  name: boundedText(120),
  sportKey: z.string().trim().min(1),
  description: optionalText(2000),
  ownerProfileId: uuid,
  place: PlaceValueSchema.nullable().optional(),
});
export type LeagueCreateInput = z.infer<typeof LeagueCreateSchema>;

/** sport_key is deliberately ABSENT — immutable in v1 (a league is one
 *  sport; changing it would silently re-home every member). `place: null`
 *  clears the location; omitting `place` leaves it untouched. The 142
 *  capability flags (operates_competitions/operates_teams) are ALSO absent
 *  on purpose — read-only v1; zod's strip drops a client-sent flag. */
export const LeagueUpdateSchema = z.object({
  name: boundedText(120).optional(),
  description: optionalText(2000),
  place: PlaceValueSchema.nullable().optional(),
});
export type LeagueUpdateInput = z.infer<typeof LeagueUpdateSchema>;

/**
 * PlaceValue → the leagues location columns, as NULLs when cleared.
 *
 * NOT placeToProfileFields' empty-string convention: that exists only
 * because the profile PUT route turns '' into NULL for its optionalFields
 * list. Leagues are written with the admin client directly, so the columns
 * take real NULLs.
 */
export function placeToLeagueColumns(
  place: LeaguePlace | null | undefined
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

/** Self-service request (116): the requester is ALWAYS the session user.
 *  zod's default strip behavior drops a client-sent ownerProfileId rather
 *  than rejecting it — the field simply cannot arrive at the route. */
export const LeagueRequestSchema = LeagueCreateSchema.omit({ ownerProfileId: true });
export type LeagueRequestInput = z.infer<typeof LeagueRequestSchema>;

/** Admin decision on a request. Decline REQUIRES a reason — enforced here
 *  (pure, unit-testable) so the route carries no hand-rolled check. */
export const LeagueRequestDecisionSchema = z
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
export type LeagueRequestDecisionInput = z.infer<typeof LeagueRequestDecisionSchema>;

/** Owner-assignable roles. 'owner' is deliberately NOT assignable — there is
 *  exactly one owner, set at creation; ownership transfer is a future admin
 *  action, not a role PATCH. */
export const LeagueMemberRoleSchema = z.object({
  role: z.enum(['manager', 'member']),
});
export type LeagueMemberRoleInput = z.infer<typeof LeagueMemberRoleSchema>;

/** Roster accept (0.3). Accept is the only PATCH action; decline is a
 *  DELETE (the row is erased, the 118 precedent). Shared by both sides —
 *  clubs/validate re-exports it. */
export const RosterAcceptSchema = z.object({
  action: z.literal('accept'),
});

/** Postgres 42P01 / PostgREST PGRST205 — the leagues tables don't exist yet
 *  (migration 113 not run). Routes degrade to 404/empty rather than 500. */
export function isMissingTableError(code: string | undefined | null): boolean {
  return code === '42P01' || code === 'PGRST205';
}
