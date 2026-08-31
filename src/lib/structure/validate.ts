/**
 * Org structure (145) — the PURE validation half (node-only vitest; no
 * framework or Supabase imports; the venues/validate.ts pattern).
 *
 * v1 is ADMIN-provisioned (Tom, Aug 31): /dashboard/structure posts these
 * to /api/admin/structure/*; org-manager CRUD arrives with phase 1's
 * dashboard. sport_key membership in FEATURE_SPORTS is checked in the
 * ROUTE (the 113 convention — this file stays registry-free), as are the
 * cross-row rules (division.org == season.org; entry team.org ==
 * division.org).
 */

import { z } from 'zod';
import { boundedText, optionalText, uuid } from '@/lib/validation';

export { isMissingTableError } from '@/lib/leagues/validate';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = z.string().regex(ISO_DATE, 'Expected YYYY-MM-DD');

export const OrgSideSchema = z.enum(['league', 'club']);

export const SeasonCreateSchema = z
  .object({
    side: OrgSideSchema,
    orgId: uuid,
    label: boundedText(60),
    startsOn: isoDate.optional(),
    endsOn: isoDate.optional(),
    sportKey: optionalText(40),
  })
  .superRefine((val, ctx) => {
    if (val.startsOn && val.endsOn && val.endsOn < val.startsOn) {
      ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'Season must end on or after it starts' });
    }
  });
export type SeasonCreateInput = z.infer<typeof SeasonCreateSchema>;

export const DivisionCreateSchema = z.object({
  seasonId: uuid,
  sportKey: boundedText(40),
  name: boundedText(80),
  ageBand: optionalText(30),
  genderStream: optionalText(30),
  tier: optionalText(30),
  capacityEstimate: z.number().int().min(1).max(10000).optional(),
});
export type DivisionCreateInput = z.infer<typeof DivisionCreateSchema>;

export const TeamCreateSchema = z.object({
  side: OrgSideSchema,
  orgId: uuid,
  name: boundedText(80),
  displayName: optionalText(80),
});
export type TeamCreateInput = z.infer<typeof TeamCreateSchema>;

/** Archive/unarchive — teams persist; the console never hard-deletes as
 *  its primary affordance (delete stays for admin mistake-cleanup). */
export const TeamPatchSchema = z.object({
  id: uuid,
  status: z.enum(['active', 'archived']),
});
export type TeamPatchInput = z.infer<typeof TeamPatchSchema>;

/** The PAIR (Tom's amendment): season derives through the division. */
export const EntryCreateSchema = z.object({
  teamId: uuid,
  divisionId: uuid,
});
export type EntryCreateInput = z.infer<typeof EntryCreateSchema>;
