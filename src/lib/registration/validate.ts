/**
 * Registration (162) — the PURE validation half (node-only vitest; no
 * framework or Supabase imports; the structure/validate.ts pattern).
 *
 * The v1 form (Tom's call, Sep 1): identity + offering + emergency
 * contact (name/phone) + free-text MEDICAL NOTES + the photo-consent
 * answer. Medical notes are SENSITIVE: the server serves them only
 * behind the manage_registration gate — never member previews, never
 * any public surface (the registrar-only rule is enforced in
 * registration-server.ts, restated here so nobody widens a select
 * without meeting it).
 *
 * Cross-row rules (window open, offering belongs to the season, the
 * collision matrix, supervised gating) live in the SERVER lib — this
 * file stays shape-only, the 113 convention.
 */

import { z } from 'zod';
import { boundedText, optionalText, uuid } from '@/lib/validation';

export { isMissingTableError } from '@/lib/leagues/validate';

export const PROGRAM_TYPES = ['camp', 'clinic', 'learn_to_play', 'other'] as const;

export const ProgramCreateSchema = z.object({
  seasonId: uuid,
  sportKey: boundedText(40),
  type: z.enum(PROGRAM_TYPES).default('other'),
  name: boundedText(80),
  capacityEstimate: z.number().int().min(1).max(10000).optional(),
});
export type ProgramCreateInput = z.infer<typeof ProgramCreateSchema>;

/** The v1 answers payload. Whole-object replace semantics; the wizard
 *  always sends the complete shape. */
export const RegistrationAnswersSchema = z.object({
  emergencyContact: z
    .object({
      name: boundedText(80),
      phone: boundedText(40),
    })
    .optional(),
  /** Sensitive — registrar-eyes-only (see the header). */
  medicalNotes: optionalText(1000),
});
export type RegistrationAnswers = z.infer<typeof RegistrationAnswersSchema>;

export const RegistrationCreateSchema = z
  .object({
    seasonId: uuid,
    divisionId: uuid.optional(),
    programId: uuid.optional(),
    /** Acting-for (a guardian registering their athlete) — the route
     *  vouches via requireProfileRole before the core sees it. */
    profileId: uuid.optional(),
    answers: RegistrationAnswersSchema.default({}),
    /** Written only when canGrantPhotoConsent passes (the 159 contract);
     *  otherwise left NULL so the guardian queue asks. */
    photoConsent: z.boolean().optional(),
    /** Offered by the wizard when the athlete has no birthday on file and
     *  the actor may set it — powers the eligibility check. */
    birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').optional(),
  })
  .superRefine((val, ctx) => {
    if (!!val.divisionId === !!val.programId) {
      ctx.addIssue({
        code: 'custom',
        path: ['divisionId'],
        message: 'Pick exactly one division or program',
      });
    }
  });
export type RegistrationCreateInput = z.infer<typeof RegistrationCreateSchema>;

/** Registrar transitions + the family withdraw — one schema, the server
 *  decides who may do which. */
export const RegistrationTransitionSchema = z.object({
  action: z.enum(['evaluate', 'place', 'release', 'withdraw']),
  /** place only: the destination team. */
  teamId: uuid.optional(),
  /** release only. */
  reason: optionalText(300),
  /** withdraw acting-for (guardian) — route-vouched. */
  profileId: uuid.optional(),
});
export type RegistrationTransitionInput = z.infer<typeof RegistrationTransitionSchema>;

export const WindowCreateSchema = z
  .object({
    seasonId: uuid,
    divisionId: uuid.optional(),
    programId: uuid.optional(),
    opensAt: z.string().datetime({ offset: true }),
    closesAt: z.string().datetime({ offset: true }).optional(),
    capacity: z.number().int().min(1).max(100000).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.divisionId && val.programId) {
      ctx.addIssue({
        code: 'custom',
        path: ['programId'],
        message: 'A window targets a division or a program, not both',
      });
    }
    if (val.closesAt && val.closesAt <= val.opensAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['closesAt'],
        message: 'The window must close after it opens',
      });
    }
  });
export type WindowCreateInput = z.infer<typeof WindowCreateSchema>;

export interface RegistrationWindowRow {
  opens_at: string;
  closes_at: string | null;
}

/** Viewer-independent open-ness — the ONE predicate the wizard, the org
 *  console and the public site card all share. */
export function isWindowOpen(window: RegistrationWindowRow, nowIso: string): boolean {
  if (window.opens_at > nowIso) return false;
  if (window.closes_at && window.closes_at <= nowIso) return false;
  return true;
}
