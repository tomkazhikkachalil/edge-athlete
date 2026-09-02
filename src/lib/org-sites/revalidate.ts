// ── Public-site freshness hooks (phase-3 cleanup) ───────────────────────────
// The masterplan's rule: "statically generate with on-demand revalidation
// when the underlying data changes." Competition writes (results, entries,
// contests, visibility flips) change the PUBLIC standings/schedule, so the
// mutators call these after a successful write — the org's site re-renders
// on the next hit instead of waiting out the 300s window.
//
// Both are BEST-EFFORT and never throw (a freshness miss must never fail
// the write that caused it); a draft or absent site is a no-op. Kept in
// its own module so competition-server can import it without touching the
// wider org-sites server surface.

import { revalidateTag } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from '@/lib/orgs/authz';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[ORG SITE REVALIDATE]';

/** The org's PUBLISHED site, or null (draft, none, or pre-155 database —
 *  never an error). Phase 6b A1 also feeds the org pages' "Public site"
 *  link from this, so the two surfaces agree on what "published" means. */
export async function findPublishedSite(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<{ subdomain: string } | null> {
  try {
    const { data: site } = await admin
      .from('org_sites')
      .select('subdomain')
      .eq(side === 'league' ? 'league_id' : 'club_id', orgId)
      .not('published_at', 'is', null)
      .maybeSingle();
    return site?.subdomain ? { subdomain: site.subdomain as string } : null;
  } catch (error) {
    console.warn(`${TAG} org lookup failed:`, error);
    return null;
  }
}

/** Purge the org's PUBLISHED site (if any) after a public-surface write. */
export async function revalidateOrgSiteForOrg(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<void> {
  try {
    const site = await findPublishedSite(admin, side, orgId);
    if (site) revalidateTag(`org-site:${site.subdomain}`, { expire: 0 });
  } catch (error) {
    console.warn(`${TAG} revalidate failed (write unaffected):`, error);
  }
}

/** Same, resolving the org from a competition id — every competition
 *  mutator has one in hand, even on unscoped (admin) paths. */
export async function revalidateOrgSiteForCompetition(
  admin: Admin,
  competitionId: string
): Promise<void> {
  try {
    const { data: comp } = await admin
      .from('competitions')
      .select('league_id, club_id')
      .eq('id', competitionId)
      .maybeSingle();
    if (!comp) return;
    const side: OrgSide = comp.league_id ? 'league' : 'club';
    const orgId = (comp.league_id ?? comp.club_id) as string | null;
    if (orgId) await revalidateOrgSiteForOrg(admin, side, orgId);
  } catch (error) {
    console.warn(`${TAG} competition lookup failed (write unaffected):`, error);
  }
}
