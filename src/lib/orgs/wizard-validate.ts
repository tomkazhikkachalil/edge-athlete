// ── Org wizard — the PURE validation half (phase 1 round 2) ─────────────────
// The draft schemas for the onboarding wizard's POST boundary. Lives here
// (not structure/validate — that file is the CRUD-input contract; not
// leagues/validate — drafts are side-agnostic) and stays REGISTRY-FREE by
// the 113 convention: sport-key membership is checked in the ROUTES, and
// the league route RE-STAMPS every division sportKey with the request's
// sport (client values are untrusted).
//
// Every wizard field is OPTIONAL on the widened request schemas, so the
// pre-wizard client payload keeps validating — back-compat is unit-pinned.
//
// Caps, with reasons: divisions 60 (a full template cross-product is
// 8 bands × 3 streams × 2 tiers = 48); teams 50; connections 10 + 10
// (each existing connection fires a real notification at approval — the
// cap bounds the fan-out one approve can trigger).

import { z } from 'zod';
import { boundedText, optionalText, uuid } from '@/lib/validation';
import { LeagueRequestSchema } from '@/lib/leagues/validate';
import { ClubRequestSchema } from '@/lib/clubs/validate';

export const CapabilitiesSchema = z
  .object({
    operatesCompetitions: z.boolean(),
    operatesTeams: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (!v.operatesCompetitions && !v.operatesTeams) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Choose at least one thing your organization runs',
      });
    }
  });
export type CapabilitiesInput = z.infer<typeof CapabilitiesSchema>;

export const DivisionDraftRowSchema = z.object({
  sportKey: boundedText(40),
  name: boundedText(80),
  ageBand: optionalText(30),
  genderStream: optionalText(30),
  tier: optionalText(30),
});
export type DivisionDraftRow = z.infer<typeof DivisionDraftRowSchema>;

export const StructureDraftSchema = z.object({
  seasonLabel: optionalText(60),
  divisions: z.array(DivisionDraftRowSchema).max(60),
  teams: z.array(boundedText(80)).max(50),
});
export type StructureDraftInput = z.infer<typeof StructureDraftSchema>;

export const ConnectionsDraftSchema = z.object({
  existing: z.array(z.object({ id: uuid, name: boundedText(120) })).max(10),
  stubs: z
    .array(
      z.object({
        name: boundedText(120),
        email: z.string().trim().toLowerCase().email().max(255).optional(),
        /** Club-side stubs are LEAGUES, whose sport_key is NOT NULL —
         *  the stub row carries an explicit sport (checked in the route). */
        sportKey: optionalText(40),
      })
    )
    .max(10),
});
export type ConnectionsDraftInput = z.infer<typeof ConnectionsDraftSchema>;

export const LeagueRequestWizardSchema = LeagueRequestSchema.extend({
  capabilities: CapabilitiesSchema.optional(),
  structure: StructureDraftSchema.optional(),
  connections: ConnectionsDraftSchema.optional(),
});
export type LeagueRequestWizardInput = z.infer<typeof LeagueRequestWizardSchema>;

export const ClubRequestWizardSchema = ClubRequestSchema.extend({
  capabilities: CapabilitiesSchema.optional(),
  structure: StructureDraftSchema.optional(),
  connections: ConnectionsDraftSchema.optional(),
});
export type ClubRequestWizardInput = z.infer<typeof ClubRequestWizardSchema>;
