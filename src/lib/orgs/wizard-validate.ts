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
import { httpsUrl } from '@/lib/org-sites/validate';

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

// Phase 7 C2: what the golf fast path collects BEYOND the request — the
// sports the org plays (a club's first entry becomes clubs.primary_sport at
// provisioning), the OPTIONAL home course (a golf club is NOT course-
// specific — it plays many courses and MAY name one), and the site's
// contact. Stored verbatim in {club,league}_requests.site_draft (174);
// C4 turns it into a venue + a draft site. Registry-free by the 113
// convention — the routes gate each sport key.
export const SiteDraftSchema = z.object({
  sports: z.array(boundedText(40)).max(12).optional(),
  homeCourseId: uuid.optional(),
  contact: z
    .object({
      website: httpsUrl.optional(),
      phone: z.string().trim().min(3).max(40).optional(),
    })
    .optional(),
});
export type SiteDraftInput = z.infer<typeof SiteDraftSchema>;

/** The wizard's website box, made into what SiteDraftSchema accepts:
 *  '' → undefined (omit); a bare host gets https://; http:// is upgraded
 *  (site links are https-only); anything that still isn't an https URL
 *  → null (the caller shows the error). */
export function normalizeWebsiteInput(raw: string): string | null | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(v);
  const withScheme = hasScheme ? v.replace(/^http:\/\//i, 'https://') : `https://${v}`;
  return httpsUrl.safeParse(withScheme).success ? withScheme : null;
}

export const LeagueRequestWizardSchema = LeagueRequestSchema.extend({
  capabilities: CapabilitiesSchema.optional(),
  structure: StructureDraftSchema.optional(),
  connections: ConnectionsDraftSchema.optional(),
  siteDraft: SiteDraftSchema.optional(),
});
export type LeagueRequestWizardInput = z.infer<typeof LeagueRequestWizardSchema>;

export const ClubRequestWizardSchema = ClubRequestSchema.extend({
  capabilities: CapabilitiesSchema.optional(),
  structure: StructureDraftSchema.optional(),
  connections: ConnectionsDraftSchema.optional(),
  siteDraft: SiteDraftSchema.optional(),
});
export type ClubRequestWizardInput = z.infer<typeof ClubRequestWizardSchema>;
