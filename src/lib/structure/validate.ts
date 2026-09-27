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

export { isMissingTableError } from '@/lib/orgs/validate';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = z.string().regex(ISO_DATE, 'Expected YYYY-MM-DD');

export const OrgKindSchema = z.enum(['league', 'club']);

export const SeasonCreateSchema = z
  .object({
    side: OrgKindSchema,
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

/** Teams & divisions PR 9: a division is editable — its name, age band,
 *  stream, tier and capacity (the sport and the season stay: moving a
 *  division across seasons or sports re-homes every entry). An empty
 *  optional field clears it (null); an absent key leaves it. */
const clearable = (max: number) =>
  z.preprocess(v => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable()).optional();
export const DivisionPatchSchema = z
  .object({
    id: uuid,
    name: boundedText(80).optional(),
    ageBand: clearable(30),
    genderStream: clearable(30),
    tier: clearable(30),
    capacityEstimate: z.number().int().min(1).max(10000).nullable().optional(),
  })
  .refine(v => Object.keys(v).some(k => k !== 'id' && (v as Record<string, unknown>)[k] !== undefined), {
    message: 'Nothing to change',
  });
export type DivisionPatchInput = z.infer<typeof DivisionPatchSchema>;

export const TeamCreateSchema = z.object({
  side: OrgKindSchema,
  orgId: uuid,
  name: boundedText(80),
  displayName: optionalText(80),
});
export type TeamCreateInput = z.infer<typeof TeamCreateSchema>;

/** Archive/unarchive — teams persist; the console never hard-deletes as
 *  its primary affordance (delete stays for admin mistake-cleanup).
 *  Teams & divisions PR 6 (242): the team's IDENTITY too — a rename, the
 *  shown name, its sport (checked against FEATURE_SPORTS in the handler, the
 *  113 convention), two colours (lower-cased `#rrggbb` — 242's CHECK). null
 *  clears an optional field; an absent key leaves it. The logo has its own
 *  upload route. At least one change is required. */
const TeamColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'A colour is a hex value like #7c3aed')
  .transform(v => v.toLowerCase());
export const TeamPatchSchema = z
  .object({
    id: uuid,
    status: z.enum(['active', 'archived']).optional(),
    name: boundedText(80).optional(),
    displayName: z.preprocess(v => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(80).nullable()).optional(),
    sportKey: z.string().trim().min(1).max(40).nullable().optional(),
    primaryColor: TeamColorSchema.nullable().optional(),
    secondaryColor: TeamColorSchema.nullable().optional(),
  })
  .refine(v => Object.keys(v).some(k => k !== 'id' && (v as Record<string, unknown>)[k] !== undefined), {
    message: 'Nothing to change',
  });
export type TeamPatchInput = z.infer<typeof TeamPatchSchema>;

/** The PAIR (Tom's amendment): season derives through the division. */
export const EntryCreateSchema = z.object({
  teamId: uuid,
  divisionId: uuid,
});
export type EntryCreateInput = z.infer<typeof EntryCreateSchema>;

/** Phase 5.5: clone a season forward. The new label must differ (the
 *  org+label unique enforces it as a 409); dates optional like create. */
export const RolloverSchema = z
  .object({
    seasonId: uuid,
    label: boundedText(60),
    startsOn: isoDate.optional(),
    endsOn: isoDate.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.startsOn && val.endsOn && val.endsOn < val.startsOn) {
      ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'Season must end on or after it starts' });
    }
  });
export type RolloverInput = z.infer<typeof RolloverSchema>;
