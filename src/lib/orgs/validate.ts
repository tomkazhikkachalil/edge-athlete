/**
 * Orgs — the PURE validation half, ONE module for both kinds (Round 5 step E,
 * Sep 2026; node-only vitest covers this file; no framework or Supabase
 * imports). The two side files it replaced (`leagues/validate.ts`,
 * `clubs/validate.ts`) were deleted in step F.
 *
 * The one designed divergence between the kinds is the SPORT: a league is
 * one sport (`sportKey` required at creation, immutable after — changing it
 * would silently re-home every member), a club is a multi-sport facility
 * (Tom, Aug 24 2026). Everything else — the place, the membership settings,
 * the listing ask, the request decision, the role PATCH, the join decision,
 * the roster schemas — is the same schema. sport_key membership in
 * FEATURE_SPORTS is checked in the ROUTE, not here: importing the sports
 * registry from a lib that copy.ts-adjacent code might touch is how the
 * import-cycle class of bug starts, so this file stays registry-free.
 */

import { z } from 'zod';
import { boundedText, optionalText, uuid } from '@/lib/validation';
import type { OrgKind } from './org-ref';

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
export type OrgPlace = z.infer<typeof PlaceValueSchema>;

const createBase = z.object({
  name: boundedText(120),
  description: optionalText(2000),
  ownerProfileId: uuid,
  place: PlaceValueSchema.nullable().optional(),
});

/** Creation is admin-provisioned (Tom, Aug 24): the dashboard posts this to
 *  /api/admin/{leagues,clubs}. A league carries its one sport; a club's
 *  schema has no sport field (zod's strip drops a client-sent one). */
export const LeagueCreateSchema = createBase.extend({ sportKey: z.string().trim().min(1) });
export const ClubCreateSchema = createBase;
export function orgCreateSchema(kind: OrgKind) {
  return kind === 'league' ? LeagueCreateSchema : ClubCreateSchema;
}
export type LeagueCreateInput = z.infer<typeof LeagueCreateSchema>;
export type ClubCreateInput = z.infer<typeof ClubCreateSchema>;
export type OrgCreateInput = LeagueCreateInput | ClubCreateInput;

/** The owner (or a manager) edits with this via /api/{leagues,clubs}/[id].
 *  sport_key is deliberately ABSENT (immutable in v1). `place: null` clears
 *  the location; omitting `place` leaves it untouched. The 142 capability
 *  flags are ALSO absent on purpose — read-only v1; zod's strip drops a
 *  client-sent flag. */
export const OrgUpdateSchema = z.object({
  name: boundedText(120).optional(),
  description: optionalText(2000),
  place: PlaceValueSchema.nullable().optional(),
  // Program 11: the membership settings (176 / 177).
  visibility: z.enum(['public', 'private']).optional(),
  joinPolicy: z.enum(['open', 'approval']).optional(),
  // Onboarding v2 R1 (179): the directory listing — ask (pending) or link only.
  listing: z.enum(['pending', 'unlisted']).optional(),
});
export type OrgUpdateInput = z.infer<typeof OrgUpdateSchema>;

/** Program 11: a manager decides a join request. */
export const OrgJoinDecisionSchema = z.object({
  requestId: uuid,
  decision: z.enum(['approve', 'decline']),
});
export type OrgJoinDecisionInput = z.infer<typeof OrgJoinDecisionSchema>;

/**
 * PlaceValue → the org's location columns, as NULLs when cleared.
 *
 * NOT placeToProfileFields' empty-string convention: that exists only
 * because the profile PUT route turns '' into NULL for its optionalFields
 * list. Orgs are written with the admin client directly, so the columns
 * take real NULLs.
 */
export function placeToOrgColumns(
  place: OrgPlace | null | undefined
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

/** Self-service request (116 / 117): the requester is ALWAYS the session
 *  user. zod's default strip behavior drops a client-sent ownerProfileId
 *  rather than rejecting it — the field simply cannot arrive at the route. */
export const LeagueRequestSchema = LeagueCreateSchema.omit({ ownerProfileId: true });
export const ClubRequestSchema = ClubCreateSchema.omit({ ownerProfileId: true });
export function orgRequestSchema(kind: OrgKind) {
  return kind === 'league' ? LeagueRequestSchema : ClubRequestSchema;
}
export type LeagueRequestInput = z.infer<typeof LeagueRequestSchema>;
export type ClubRequestInput = z.infer<typeof ClubRequestSchema>;

/** Admin decision on a request. Decline REQUIRES a reason — enforced here
 *  (pure, unit-testable) so the route carries no hand-rolled check. */
export const OrgRequestDecisionSchema = z
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
export type OrgRequestDecisionInput = z.infer<typeof OrgRequestDecisionSchema>;

/** Owner-assignable roles for the role PATCH. 'owner' is deliberately NOT
 *  here — owner-set changes go through /owners (0.8): owners mint co-owners
 *  and step down themselves; transfer = promote + step down. */
export const OrgMemberRoleSchema = z.object({
  role: z.enum(['manager', 'member']),
});
export type OrgMemberRoleInput = z.infer<typeof OrgMemberRoleSchema>;

/** Roster accept (0.3/0.10). Accept is the only PATCH action; decline is a
 *  DELETE (the row is erased, the 118 precedent). `profileId` (0.10) is the
 *  guardian acting-for target — the route gates it with requireProfileRole
 *  before the core ever sees it. */
export const RosterAcceptSchema = z.union([
  z.object({
    action: z.literal('accept'),
    profileId: z.string().uuid().optional(),
    /** Phase 4 R4: recorded at accept only when the actor may grant it
     *  (canGrantPhotoConsent) — otherwise silently left unasked. */
    photoConsent: z.boolean().optional(),
  }),
  /** Phase 4 R4: the standalone per-org photo-consent toggle — an adult
   *  athlete for themselves, or a guardian acting for a supervised
   *  athlete (route-gated). Orgs never send this. */
  z.object({
    action: z.literal('set_photo_consent'),
    profileId: z.string().uuid().optional(),
    consent: z.boolean(),
  }),
]);

/** Roster import (phase 1 R3) — a discriminated pair: paste-import into
 *  one team, or re-mint a claim link for an unclaimed stub. The 50-row cap
 *  is enforced in the ROUTE (rows come from parseRosterImport, not this
 *  schema). */
export const RosterImportSchema = z.union([
  z.object({ teamId: uuid, text: z.string().min(1).max(20_000) }),
  z.object({ remintProfileId: uuid }),
]);
export type RosterImportInput = z.infer<typeof RosterImportSchema>;

/** Postgres 42P01 / PostgREST PGRST205 — a table does not exist (a
 *  migration not run). Routes degrade to 404/empty rather than 500. */
export function isMissingTableError(code: string | undefined | null): boolean {
  return code === '42P01' || code === 'PGRST205';
}
