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

export const SitePatchSchema = z.object({
  action: z.enum(['publish', 'unpublish']),
});
export type SitePatchInput = z.infer<typeof SitePatchSchema>;
