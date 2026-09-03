// ── Private clubs on the public site (phase 9 V4) — the PURE gate ───────────
// Tom: a private club's site shows identity + public items only. These
// modules are members-only there and render a "Members only" panel
// instead (a stable, cacheable 200 — never a 404, never a session read);
// hero, contact, courses, schedule, news, documents, register and the
// notice band stay public. Decided from `site.visibility` alone.

// `staff` too: the managers' names are people, not identity (the spec caught
// the owner's masked name on a private home).
export const MEMBERS_ONLY_MODULE_KEYS = ['standings', 'teams', 'divisions', 'leaders', 'gallery', 'staff'] as const;

export function isMembersOnly(site: { visibility: 'public' | 'private' }, moduleKey: string): boolean {
  return site.visibility === 'private' && (MEMBERS_ONLY_MODULE_KEYS as readonly string[]).includes(moduleKey);
}

/** Sitemap: a private club's crawlable sub-URLs — the public modules only. */
export function publicSubpageKeys(visibility: 'public' | 'private', keys: string[]): string[] {
  return visibility === 'private' ? keys.filter(k => !(MEMBERS_ONLY_MODULE_KEYS as readonly string[]).includes(k)) : keys;
}
