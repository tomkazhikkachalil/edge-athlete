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
import type { SiteBrandRow } from './brand';
import { loadDraftSnapshotBySiteId, loadSnapshotByRevisionId } from './revisions-server';
import type { OrgSide } from '@/lib/orgs/authz';
import type { SiteSnapshot } from '@/lib/site-builder/snapshot';
import { parseStoredLayout } from '@/lib/site-builder/layout-schema';
import type { SiteLayout } from '@/lib/site-builder/layout';

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

/** Phase 10: the brand row plus the site's stored grid layout — the
 *  PUBLISHED revision's, always (H3). Null = no published layout. */
export interface SiteBrandRowWithLayout extends SiteBrandRow {
  layout: SiteLayout | null;
}

/** Which snapshot feeds what — Site Builder hardening H3 (Sep 9 2026).
 *  Pure, so the rule is testable without a database:
 *  - BRAND (hero, theme): the published rows while the site is live; while
 *    it is OFFLINE the draft is the only brand there is, so the draft's
 *    ("a draft site's brand renders for everyone" — Tom); no draft → rows.
 *  - LAYOUT (the in-app composition): the PUBLISHED revision's, or null.
 *    Never the draft's — a paragraph typed in the editor must not render on
 *    the in-app page for every member before Publish (the content widgets'
 *    promise: "under the publish gate with everything else"). */
export function composeBrandSources(input: {
  published_at: string | null;
  draft: SiteSnapshot | null;
  published: SiteSnapshot | null;
}): { hero: unknown | undefined; theme: unknown | undefined; layout: SiteLayout | null } {
  const layout = input.published ? parseStoredLayout(input.published.layout) : null;
  if (!input.published_at && input.draft) return { hero: input.draft.hero, theme: input.draft.theme, layout };
  return { hero: undefined, theme: undefined, layout };
}

const BRAND_COLUMNS = 'id, subdomain, logo_path, hero_config, theme_token_set, published_at';
const BRAND_COLUMNS_180 = `${BRAND_COLUMNS}, draft_revision_id, published_revision_id`;

/** The org's site row for the in-app brand (Org Pages R2) — draft OR
 *  published, the six columns buildOrgBrand needs. Never throws; pre-155
 *  or no row reads null. One read serves both `site` (published-only, the
 *  "Public site" link) and `brand` on the org GET — and, with
 *  `{ layout: true }` (phase 10), the composition the in-app page follows. */
export async function readSiteBrandRow(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  opts?: { layout?: boolean }
): Promise<SiteBrandRowWithLayout | null> {
  try {
    const orgColumn = side === 'league' ? 'league_id' : 'club_id';
    let { data, error } = await admin.from('org_sites').select(BRAND_COLUMNS_180).eq(orgColumn, orgId).maybeSingle();
    if (error?.code === '42703' || error?.code === 'PGRST204') {
      // Pre-180: no pointer columns — the six, no layout.
      ({ data, error } = await admin.from('org_sites').select(BRAND_COLUMNS).eq(orgColumn, orgId).maybeSingle());
    }
    if (error || !data?.id || !data.subdomain) return null;
    const row: SiteBrandRowWithLayout = {
      id: data.id as string,
      subdomain: data.subdomain as string,
      logo_path: (data.logo_path as string | null) ?? null,
      hero_config: data.hero_config,
      theme_token_set: data.theme_token_set,
      published_at: (data.published_at as string | null) ?? null,
      layout: null,
    };
    const pointers = data as { draft_revision_id?: string | null; published_revision_id?: string | null };
    // Site Builder P2-B: the rows are the PUBLISHED projection. While the
    // site is live, in-app = live (a member never sees a different hero
    // in-app than on the site). While it is OFFLINE the draft's hero/theme
    // show. The LAYOUT (phase 10) comes from the published revision ONLY —
    // composeBrandSources is the rule; H3 closed the draft-layout leak.
    const draft = !row.published_at
      ? pointers.draft_revision_id
        ? await loadSnapshotByRevisionId(admin, pointers.draft_revision_id)
        : await loadDraftSnapshotBySiteId(admin, row.id)
      : null;
    const published = opts?.layout && pointers.published_revision_id ? await loadSnapshotByRevisionId(admin, pointers.published_revision_id) : null;
    const sources = composeBrandSources({ published_at: row.published_at, draft, published });
    return {
      ...row,
      ...(sources.hero !== undefined ? { hero_config: sources.hero } : {}),
      ...(sources.theme !== undefined ? { theme_token_set: sources.theme } : {}),
      layout: opts?.layout ? sources.layout : null,
    };
  } catch (error) {
    console.warn(`${TAG} site brand lookup failed:`, error);
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
    // Phase 6c G3: a league's boards also show on its affiliated clubs'
    // pages ("this week at the club") — purge those too, bounded.
    if (side === 'league') {
      const { data: edges } = await admin
        .from('league_clubs')
        .select('club_id')
        .eq('league_id', orgId)
        .eq('status', 'active')
        .limit(10);
      for (const e of edges ?? []) await revalidateOrgSiteForOrg(admin, 'club', e.club_id as string);
    }
  } catch (error) {
    console.warn(`${TAG} competition lookup failed (write unaffected):`, error);
  }
}
