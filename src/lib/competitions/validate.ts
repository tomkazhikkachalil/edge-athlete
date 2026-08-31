/**
 * Competitions (151) — the PURE validation half (node-only vitest; no
 * framework or Supabase imports; the structure/validate.ts pattern).
 *
 * Phase-2 v1 gates (Tom, Aug 31): only fixture+team and leaderboard+
 * athlete are creatable — bracket/meet/ad_hoc_team are front-loaded in
 * the DB CHECKs but rejected HERE until their rounds arrive. sport_key
 * membership in FEATURE_SPORTS is checked in the ROUTE (the 113
 * convention — this file stays registry-free), as are all cross-row
 * rules (season.org == competition.org; division belongs to the season;
 * entered team ownership; roster-only athlete entrants).
 *
 * scoring_rule is an app-side registry key (competitions/scoring.ts,
 * R3); NULL means the sport adapter's default. Validated here only for
 * shape — the scoring registry gates unknown keys at compute time.
 */

import { z } from 'zod';
import { boundedText, optionalText, uuid } from '@/lib/validation';

export { isMissingTableError } from '@/lib/leagues/validate';
export { OrgSideSchema } from '@/lib/structure/validate';
import { OrgSideSchema } from '@/lib/structure/validate';

/** The v1 creatable pairs. Widening a round = widening THIS, not the DB. */
export const COMPETITION_FORMATS_V1 = ['fixture', 'leaderboard'] as const;
export const FORMAT_ENTRANTS: Record<(typeof COMPETITION_FORMATS_V1)[number], 'team' | 'athlete'> = {
  fixture: 'team',
  leaderboard: 'athlete',
};

export const CompetitionCreateSchema = z
  .object({
    side: OrgSideSchema,
    orgId: uuid,
    seasonId: uuid,
    divisionId: uuid.optional(),
    sportKey: boundedText(40),
    name: boundedText(80),
    format: z.enum(COMPETITION_FORMATS_V1),
    scoringRule: optionalText(40),
    visibility: z.enum(['public', 'private']).default('private'),
  });
export type CompetitionCreateInput = z.infer<typeof CompetitionCreateSchema>;

/** Lifecycle + visibility edits. Name edits deliberately absent v1 —
 *  the org+season+name unique is the duplicate authority. */
export const CompetitionPatchSchema = z
  .object({
    id: uuid,
    status: z.enum(['draft', 'active', 'completed', 'archived']).optional(),
    visibility: z.enum(['public', 'private']).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.status === undefined && val.visibility === undefined) {
      ctx.addIssue({ code: 'custom', path: ['status'], message: 'Nothing to change' });
    }
  });
export type CompetitionPatchInput = z.infer<typeof CompetitionPatchSchema>;

/** One entrant, kind-matched to the competition's entrant_type in the
 *  server lib (never trusted from the client). */
export const EntryAddSchema = z
  .object({
    competitionId: uuid,
    teamId: uuid.optional(),
    profileId: uuid.optional(),
  })
  .superRefine((val, ctx) => {
    const kinds = [val.teamId, val.profileId].filter(Boolean).length;
    if (kinds !== 1) {
      ctx.addIssue({ code: 'custom', path: ['teamId'], message: 'Exactly one of teamId or profileId' });
    }
  });
export type EntryAddInput = z.infer<typeof EntryAddSchema>;
