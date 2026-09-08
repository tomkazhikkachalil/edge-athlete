// ── Org approval leftovers (phase 7 C4 → Onboarding v2 R1) ──────────────────
// The approval GATES moved to src/lib/orgs/listing.ts (179): an org is live
// by link from creation and approval decides only the LISTING. What stays
// here is the one pure helper the provisioning path still uses.

import { SiteDraftSchema } from './wizard-validate';

/** PURE: the site draft's contact → the site's contact_config (the same
 *  keys set_contact writes); null when there is nothing to seed. */
export function siteDraftToContact(siteDraft: unknown): { website?: string; phone?: string } | null {
  const parsed = SiteDraftSchema.safeParse(siteDraft ?? {});
  if (!parsed.success || !parsed.data.contact) return null;
  const { website, phone } = parsed.data.contact;
  const contact = { ...(website ? { website } : {}), ...(phone ? { phone } : {}) };
  return Object.keys(contact).length > 0 ? contact : null;
}
