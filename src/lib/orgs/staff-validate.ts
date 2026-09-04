// ── Staff invite / grant validation (org staff program, 178) ────────────────
// Pure zod, shared by the route twins and the unit tests. The shape rule
// mirrors memberships_staff_shape_check exactly: admin ⇒ org scope, no
// sections; staff ⇒ ≥ 1 section ⊆ ORG_SECTIONS; a division/team scope
// needs its id, an org scope must not carry one.

import { z } from 'zod';
import { ORG_SECTIONS } from './authz';

const uuid = z.string().uuid();
const SectionSchema = z.enum(ORG_SECTIONS);

export const StaffGrantSchema = z
  .object({
    role: z.enum(['admin', 'staff']),
    sections: z.array(SectionSchema).max(ORG_SECTIONS.length).optional(),
    scopeType: z.enum(['org', 'division', 'team']).default('org'),
    scopeId: uuid.nullable().optional(),
    seasonId: uuid.nullable().optional(),
  })
  .superRefine((g, ctx) => {
    if (g.role === 'admin') {
      if (g.scopeType !== 'org') ctx.addIssue({ code: 'custom', message: 'An admin is org-wide', path: ['scopeType'] });
      if (g.sections && g.sections.length > 0) ctx.addIssue({ code: 'custom', message: 'An admin has every section', path: ['sections'] });
    } else if (!g.sections || g.sections.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Pick at least one section', path: ['sections'] });
    }
    if (g.scopeType === 'org' && g.scopeId) ctx.addIssue({ code: 'custom', message: 'An org-wide grant has no scope id', path: ['scopeId'] });
    if (g.scopeType !== 'org' && !g.scopeId) ctx.addIssue({ code: 'custom', message: 'Pick the division or team', path: ['scopeId'] });
  });
export type StaffGrantInput = z.infer<typeof StaffGrantSchema>;

export const StaffInviteCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  grant: StaffGrantSchema,
});
export type StaffInviteCreateInput = z.infer<typeof StaffInviteCreateSchema>;

export const StaffRowPatchSchema = z.object({
  sections: z.array(SectionSchema).min(1).max(ORG_SECTIONS.length),
});

/** Sections deduplicated in ORG_SECTIONS order (the DB stores what the
 *  console shows). Pure. */
export function normalizeSections(sections: readonly string[] | null | undefined): string[] {
  const set = new Set(sections ?? []);
  return ORG_SECTIONS.filter(s => set.has(s));
}

/** The union of an existing grant and a new one (grants are additive —
 *  masterplan §5). Pure. */
export function mergeSections(existing: readonly string[] | null | undefined, incoming: readonly string[]): string[] {
  return normalizeSections([...(existing ?? []), ...incoming]);
}

export const SECTION_LABELS: Record<(typeof ORG_SECTIONS)[number], string> = {
  website: 'Website',
  roster: 'Roster',
  membership: 'Membership',
  seasons: 'Seasons & divisions',
  teams: 'Teams',
  competitions: 'Competitions & schedule',
  registrations: 'Registrations',
  external: 'Affiliations',
  venues: 'Venues',
};

/** One line a human reads: "Admin (every section)" / "Teams, Venues". Pure. */
export function describeGrant(grant: { role: string; sections?: readonly string[] | null }): string {
  if (grant.role === 'admin') return 'Admin (every section)';
  const labels = normalizeSections(grant.sections).map(s => SECTION_LABELS[s as keyof typeof SECTION_LABELS]);
  return labels.length ? labels.join(', ') : 'No sections';
}
