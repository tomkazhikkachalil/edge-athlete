/**
 * Org sites (155) — the PURE validation half (node-only vitest; no
 * framework or Supabase imports; the structure/validate.ts pattern).
 *
 * The subdomain is a DNS LABEL: [a-z0-9-], 3–63, no edge hyphens —
 * deliberately STRICTER than is_valid_handle (006 allows '.' and '_',
 * both illegal in DNS). slugifyOrgName is the minting half: org name →
 * candidate label; collision/reserved handling is the server lib's job.
 */

import { z } from 'zod';

export { isMissingTableError } from '@/lib/leagues/validate';

export const SUBDOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
export const SUBDOMAIN_MIN = 3;
export const SUBDOMAIN_MAX = 63;

export function isValidSubdomain(value: string): boolean {
  return (
    value.length >= SUBDOMAIN_MIN &&
    value.length <= SUBDOMAIN_MAX &&
    SUBDOMAIN_RE.test(value)
  );
}

/** Org name → DNS-label candidate: lowercase, non-alphanumerics collapse
 *  to single hyphens, edges trimmed, padded to the 3-char floor. */
export function slugifyOrgName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SUBDOMAIN_MAX);
  const trimmed = base.replace(/-+$/g, '');
  if (trimmed.length >= SUBDOMAIN_MIN) return trimmed;
  return (trimmed + '-site').slice(0, SUBDOMAIN_MAX).replace(/^-+/, 'org-');
}

/** The nine module keys, in default render order. Page slugs must never
 *  collide with these (the /org/{slug}/{page} route shadow rule). */
export const MODULE_KEYS = [
  'hero',
  'standings',
  'schedule',
  'teams',
  'staff',
  'venues',
  'affiliations',
  'sponsors',
  'contact',
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

/** Every module except hero can be toggled from the console (hero is the
 *  site's identity — excluded at the SCHEMA level, not just the UI). */
export const TOGGLEABLE_MODULE_KEYS = [
  'standings',
  'schedule',
  'teams',
  'staff',
  'venues',
  'affiliations',
  'sponsors',
  'contact',
] as const;
export type ToggleableModuleKey = (typeof TOGGLEABLE_MODULE_KEYS)[number];

export const SitePatchSchema = z.union([
  z.object({ action: z.enum(['publish', 'unpublish']) }),
  z.object({
    action: z.literal('set_module'),
    moduleKey: z.enum(TOGGLEABLE_MODULE_KEYS),
    enabled: z.boolean(),
  }),
]);
export type SitePatchInput = z.infer<typeof SitePatchSchema>;

/** Public section titles, shared by the site home, the layout nav, and
 *  the module subpages (hero deliberately absent — it has no heading). */
export const MODULE_TITLES: Record<string, string> = {
  standings: 'Standings',
  schedule: 'Schedule',
  teams: 'Teams',
  staff: 'Staff',
  venues: 'Venues',
  affiliations: 'Affiliations',
  sponsors: 'Sponsors',
  contact: 'Contact',
};

/** The module keys that have their own subpage under /org/{slug}/. */
export const MODULE_SUBPAGE_KEYS = ['standings', 'schedule', 'teams'] as const;

// ── Schedule query clamps (phase 3 R2) ──────────────────────────────────────
// The public schedule reads take caller-supplied limit/range params; both
// are clamped here (pure, node-testable) so no caller can turn the
// viewer-independent read into an unbounded scan.

export const SCHEDULE_LIMIT_DEFAULT = 10;
export const SCHEDULE_LIMIT_MAX = 50;
export const SCHEDULE_RANGE_MAX_DAYS = 365;

export interface ScheduleQuery {
  limit: number;
  rangeDays?: number;
}

function toInt(value: unknown): number | null {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  return Number.isFinite(n) ? Math.floor(n) : null;
}

export function clampScheduleQuery(
  input: { limit?: unknown; rangeDays?: unknown } = {}
): ScheduleQuery {
  const limitRaw = toInt(input.limit);
  const limit =
    limitRaw === null
      ? SCHEDULE_LIMIT_DEFAULT
      : Math.min(Math.max(limitRaw, 1), SCHEDULE_LIMIT_MAX);
  const rangeRaw = toInt(input.rangeDays);
  if (rangeRaw === null) return { limit };
  return { limit, rangeDays: Math.min(Math.max(rangeRaw, 1), SCHEDULE_RANGE_MAX_DAYS) };
}
