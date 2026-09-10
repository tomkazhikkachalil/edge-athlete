// ── Recruiting profile — the zod half (server routes only) ────────────────
// Reads are TOLERANT (the vitals_privacy pattern): unknown keys dropped,
// malformed input → the empty profile, so a bad row can never crash a
// viewer. Writes go through parseRecruitingPatch, so stored JSON is
// always in-contract.

import { z } from 'zod';
import {
  ACADEMIC_NOTES_MAX,
  EMPTY_RECRUITING_PROFILE,
  RECRUITING_STATUSES,
  SCHOOL_MAX,
  TARGET_LEVELS,
  type RecruitingProfile,
} from './profile';

const profileSchema = z.object({
  gpa: z.number().min(0).max(5).nullable().optional(),
  academic_notes: z.string().trim().max(ACADEMIC_NOTES_MAX).nullable().optional(),
  target_level: z.enum(TARGET_LEVELS).nullable().optional(),
});

/** Tolerant parse of the stored blob. */
export function parseRecruitingProfile(raw: unknown): RecruitingProfile {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...EMPTY_RECRUITING_PROFILE };
  }
  const result = profileSchema.safeParse(raw);
  if (!result.success) return { ...EMPTY_RECRUITING_PROFILE };
  const d = result.data;
  return {
    gpa: typeof d.gpa === 'number' ? Math.round(d.gpa * 100) / 100 : null,
    academic_notes: d.academic_notes ? d.academic_notes : null,
    target_level: d.target_level ?? null,
  };
}

export const RecruitingPatchSchema = z
  .object({
    status: z.enum(RECRUITING_STATUSES).optional(),
    school: z.string().trim().max(SCHOOL_MAX).nullable().optional(),
    profile: profileSchema.optional(),
  })
  .strict();
export type RecruitingPatch = z.infer<typeof RecruitingPatchSchema>;

/** The PATCH body → the column writes (only the keys the client sent). */
export function recruitingPatchToUpdate(
  patch: RecruitingPatch,
  current: RecruitingProfile
): { recruiting_status?: string; school?: string | null; recruiting_profile?: RecruitingProfile } {
  const update: { recruiting_status?: string; school?: string | null; recruiting_profile?: RecruitingProfile } = {};
  if (patch.status !== undefined) update.recruiting_status = patch.status;
  if (patch.school !== undefined) update.school = patch.school ? patch.school : null;
  if (patch.profile !== undefined) {
    // Merge over the stored profile, then re-parse so the stored shape is
    // exactly the contract (rounded GPA, empty notes → null).
    update.recruiting_profile = parseRecruitingProfile({ ...current, ...patch.profile });
  }
  return update;
}
