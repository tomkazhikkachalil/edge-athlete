// ── Org site CRUD — the shared core (phase 3 R1) ────────────────────────────
// The structure-server pattern for migration 155. Site editing gates on
// 'manage_org' (owner/manager) — the Site Editor role is DEFERRED with
// its memberships scope-CHECK widening (the recorded defuse-first
// obligation), exactly as Competition Admin was in phase 2.
//
// Subdomain minting: slugified org name, checked against the SHARED
// reserved_handles denylist + the LOWER-unique column, with -2..-20
// collision suffixes. IMMUTABLE after first publish (v1 — slug-change
// 301 history is deferred; handle_history is the model when it comes).
//
// getPublicSiteBySlug is the (public) segment's read: published sites
// only, viewer-independent by construction (the standings contract).

import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from '@/lib/orgs/authz';
import {
  isMissingTableError,
  isValidSubdomain,
  MODULE_KEYS,
  slugifyOrgName,
  type SitePatchInput,
} from './validate';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[ORG SITES]';

function orgColumn(side: OrgSide): 'league_id' | 'club_id' {
  return side === 'league' ? 'league_id' : 'club_id';
}

export interface SiteRow {
  id: string;
  league_id: string | null;
  club_id: string | null;
  subdomain: string;
  template_id: string;
  theme_token_set: Record<string, unknown>;
  nav_config: unknown[];
  logo_path: string | null;
  hero_config: Record<string, unknown>;
  contact_config: Record<string, unknown>;
  published_at: string | null;
}

const SITE_FIELDS =
  'id, league_id, club_id, subdomain, template_id, theme_token_set, nav_config, logo_path, hero_config, contact_config, published_at';

/** Mint a free subdomain from the org name: base, then base-2..base-20.
 *  Reserved (shared denylist) and taken labels are skipped. */
export async function mintSubdomain(admin: Admin, orgName: string): Promise<string | null> {
  const base = slugifyOrgName(orgName);
  const candidates = [base, ...Array.from({ length: 19 }, (_, i) => `${base}-${i + 2}`)]
    .map(c => c.slice(0, 63))
    .filter(isValidSubdomain);
  if (candidates.length === 0) return null;

  const [{ data: reserved }, { data: taken }] = await Promise.all([
    admin.from('reserved_handles').select('handle').in('handle', candidates),
    admin.from('org_sites').select('subdomain').in('subdomain', candidates),
  ]);
  const blocked = new Set([
    ...(reserved ?? []).map(r => (r.handle as string).toLowerCase()),
    ...(taken ?? []).map(r => (r.subdomain as string).toLowerCase()),
  ]);
  return candidates.find(c => !blocked.has(c)) ?? null;
}

/** The console read: this org's site (draft or published) with its
 *  ordered module rows (R2: the Sections toggles), or null site. */
export async function siteGET(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<NextResponse> {
  const { data, error } = await admin
    .from('org_sites')
    .select(SITE_FIELDS)
    .eq(orgColumn(side), orgId)
    .maybeSingle();
  if (error && !isMissingTableError(error.code)) {
    console.error(`${TAG} site read error:`, error);
    return NextResponse.json({ error: 'Failed to load the site' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ site: null, modules: [] });
  const { data: modules } = await admin
    .from('org_site_modules')
    .select('module_key, enabled, sort_order, config')
    .eq('site_id', data.id)
    .order('sort_order', { ascending: true })
    .limit(20);
  return NextResponse.json({ site: data, modules: modules ?? [] });
}

/** Create-with-defaults: mint the subdomain, insert the site + all nine
 *  module rows (one homogeneous batch — the PGRST102 rule), draft state.
 *  An existing site answers 409 (one per org, DB-enforced too). */
export async function siteCreatePOST(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  orgName: string
): Promise<NextResponse> {
  const { data: existing } = await admin
    .from('org_sites')
    .select('id')
    .eq(orgColumn(side), orgId)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: 'This organization already has a site' }, { status: 409 });
  }

  const subdomain = await mintSubdomain(admin, orgName);
  if (!subdomain) {
    return NextResponse.json(
      { error: 'Could not derive a web address from the organization name' },
      { status: 400 }
    );
  }

  const { data: site, error } = await admin
    .from('org_sites')
    .insert({ [orgColumn(side)]: orgId, subdomain })
    .select(SITE_FIELDS)
    .single();
  if (error || !site) {
    if (error?.code === '23505') {
      return NextResponse.json({ error: 'This organization already has a site' }, { status: 409 });
    }
    console.error(`${TAG} site insert error:`, error);
    return NextResponse.json({ error: 'Failed to create the site' }, { status: 500 });
  }

  const { error: modulesError } = await admin.from('org_site_modules').insert(
    MODULE_KEYS.map((key, i) => ({
      site_id: site.id,
      module_key: key,
      enabled: true,
      sort_order: i,
      config: {},
    }))
  );
  if (modulesError) {
    // Compensate: a site without its module rows renders nothing.
    await admin.from('org_sites').delete().eq('id', site.id);
    console.error(`${TAG} modules insert error:`, modulesError);
    return NextResponse.json({ error: 'Failed to create the site' }, { status: 500 });
  }
  return NextResponse.json({ site });
}

/** Publish/unpublish, toggle one module (R2), or write branding config
 *  (R3: hero, theme accent, sponsors). Every branch ends in revalidateTag
 *  — publish must be immediate, not 300s-stale, and every edit flips
 *  home + subpages through the same tag. */
export async function sitePATCH(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  input: SitePatchInput
): Promise<NextResponse> {
  if (
    input.action === 'set_hero' ||
    input.action === 'set_theme' ||
    input.action === 'set_contact'
  ) {
    const patch =
      input.action === 'set_hero'
        ? {
            hero_config: {
              ...(input.headline ? { headline: input.headline } : {}),
              ...(input.tagline ? { tagline: input.tagline } : {}),
            },
          }
        : input.action === 'set_contact'
          ? {
              // Deliberately public, manager-entered org contact info.
              contact_config: {
                ...(input.email ? { email: input.email } : {}),
                ...(input.phone ? { phone: input.phone } : {}),
                ...(input.website ? { website: input.website } : {}),
              },
            }
          : // null clears back to the violet defaults. Whole-object replace on
            // every branch — the console always sends every field, seeded
            // from GET (a partial save would otherwise clear the rest).
            { theme_token_set: input.accent ? { accent: input.accent.toLowerCase() } : {} };
    const { data: updated, error } = await admin
      .from('org_sites')
      .update(patch)
      .eq(orgColumn(side), orgId)
      .select('id, subdomain');
    if (error) {
      console.error(`${TAG} branding patch error:`, error);
      return NextResponse.json({ error: 'Failed to update the site' }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }
    revalidateTag(`org-site:${updated[0].subdomain}`, { expire: 0 });
    return NextResponse.json({ ok: true });
  }

  if (input.action === 'set_sponsors') {
    const { data: site } = await admin
      .from('org_sites')
      .select('id, subdomain')
      .eq(orgColumn(side), orgId)
      .maybeSingle();
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }
    // Cross-site guard (the pagePATCH recipe): every logo must live under
    // THIS site's asset prefix — the schema can't know the site id.
    for (const sponsor of input.sponsors) {
      if (sponsor.logoPath && !sponsor.logoPath.startsWith(`org-media/${site.id}/`)) {
        return NextResponse.json(
          { error: 'Logo is not one of this site’s assets' },
          { status: 400 }
        );
      }
    }
    // UPDATE, never upsert — an upsert would clobber sort_order/enabled.
    const { data: updated, error } = await admin
      .from('org_site_modules')
      .update({ config: { sponsors: input.sponsors } })
      .eq('site_id', site.id)
      .eq('module_key', 'sponsors')
      .select('module_key');
    if (error) {
      console.error(`${TAG} sponsors patch error:`, error);
      return NextResponse.json({ error: 'Failed to update sponsors' }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      const { error: insertError } = await admin.from('org_site_modules').insert({
        site_id: site.id,
        module_key: 'sponsors',
        enabled: true,
        sort_order: MODULE_KEYS.indexOf('sponsors'),
        config: { sponsors: input.sponsors },
      });
      if (insertError) {
        console.error(`${TAG} sponsors insert error:`, insertError);
        return NextResponse.json({ error: 'Failed to update sponsors' }, { status: 500 });
      }
    }
    revalidateTag(`org-site:${site.subdomain}`, { expire: 0 });
    return NextResponse.json({ ok: true });
  }

  if (input.action === 'set_module') {
    const { data: site } = await admin
      .from('org_sites')
      .select('id, subdomain')
      .eq(orgColumn(side), orgId)
      .maybeSingle();
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }
    // UPDATE, never upsert — an upsert would clobber sort_order/config.
    const { data: updated, error } = await admin
      .from('org_site_modules')
      .update({ enabled: input.enabled })
      .eq('site_id', site.id)
      .eq('module_key', input.moduleKey)
      .select('module_key');
    if (error) {
      console.error(`${TAG} module toggle error:`, error);
      return NextResponse.json({ error: 'Failed to update the section' }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      // Self-heal a missing row (pre-R1 sites shouldn't exist, but a
      // deleted row must not brick the toggle) at its default position.
      const { error: insertError } = await admin.from('org_site_modules').insert({
        site_id: site.id,
        module_key: input.moduleKey,
        enabled: input.enabled,
        sort_order: MODULE_KEYS.indexOf(input.moduleKey),
        config: {},
      });
      if (insertError) {
        console.error(`${TAG} module insert error:`, insertError);
        return NextResponse.json({ error: 'Failed to update the section' }, { status: 500 });
      }
    }
    revalidateTag(`org-site:${site.subdomain}`, { expire: 0 });
    return NextResponse.json({ module: { module_key: input.moduleKey, enabled: input.enabled } });
  }

  const { data: updated, error } = await admin
    .from('org_sites')
    .update({ published_at: input.action === 'publish' ? new Date().toISOString() : null })
    .eq(orgColumn(side), orgId)
    .select('id, subdomain, published_at');
  if (error) {
    console.error(`${TAG} site patch error:`, error);
    return NextResponse.json({ error: 'Failed to update the site' }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  }
  // The ISR documents re-render on the next hit (publish must be
  // immediate, not 300s-stale — the preview-then-publish flow). The
  // sitemap enumerator purges too (R4): a published site must enter
  // /sitemap.xml immediately, an unpublished one must leave it.
  revalidateTag(`org-site:${updated[0].subdomain}`, { expire: 0 });
  revalidateTag('org-sitemap', { expire: 0 });
  return NextResponse.json({ site: updated[0] });
}

export interface PublicSite extends SiteRow {
  orgName: string;
  side: OrgSide;
  orgId: string;
  // R4: public org geography + sport for JSON-LD (nullable — clubs have
  // no sport_key, and location columns may be empty).
  orgCity: string | null;
  orgRegion: string | null;
  orgCountry: string | null;
  orgSportKey: string | null;
  modules: { module_key: string; enabled: boolean; sort_order: number; config: unknown }[];
}

/** The (public) segment's read: a PUBLISHED site by slug, with its org
 *  name and ordered modules. Viewer-independent by construction —
 *  nothing here may branch on a session (the standings contract). */
export async function getPublicSiteBySlug(
  admin: Admin,
  slug: string
): Promise<PublicSite | null> {
  return getSiteBySlugInternal(admin, slug, false);
}

/** DRAFT-TOLERANT twin for the token-gated preview route ONLY — the
 *  signed preview token is the authorization; every other public read
 *  keeps the publish gate. */
export async function getSiteBySlugAnyStatus(
  admin: Admin,
  slug: string
): Promise<PublicSite | null> {
  return getSiteBySlugInternal(admin, slug, true);
}

async function getSiteBySlugInternal(
  admin: Admin,
  slug: string,
  includeDrafts: boolean
): Promise<PublicSite | null> {
  if (!isValidSubdomain(slug.toLowerCase())) return null;
  let query = admin.from('org_sites').select(SITE_FIELDS).ilike('subdomain', slug);
  if (!includeDrafts) query = query.not('published_at', 'is', null);
  const { data: site, error } = await query.maybeSingle();
  if (error || !site) {
    if (error && !isMissingTableError(error.code)) {
      console.error(`${TAG} public site read error:`, error);
    }
    return null;
  }

  const side: OrgSide = site.league_id ? 'league' : 'club';
  const orgId = (site.league_id ?? site.club_id) as string;
  const [{ data: org }, { data: modules }] = await Promise.all([
    admin
      .from(side === 'league' ? 'leagues' : 'clubs')
      // R4 widens the org read for JSON-LD: geography both sides,
      // sport_key leagues only (clubs have no such column — mig 108/113).
      .select(
        side === 'league'
          ? 'id, name, city, region, country, sport_key'
          : 'id, name, city, region, country'
      )
      .eq('id', orgId)
      .maybeSingle(),
    admin
      .from('org_site_modules')
      .select('module_key, enabled, sort_order, config')
      .eq('site_id', site.id)
      .order('sort_order', { ascending: true })
      .limit(20),
  ]);
  if (!org) return null;

  // The dynamic select string defeats supabase-js's type parser; cast once.
  const orgRow = org as unknown as {
    name: string;
    city?: string | null;
    region?: string | null;
    country?: string | null;
    sport_key?: string | null;
  };
  return {
    ...(site as SiteRow),
    orgName: orgRow.name,
    side,
    orgId,
    orgCity: orgRow.city ?? null,
    orgRegion: orgRow.region ?? null,
    orgCountry: orgRow.country ?? null,
    orgSportKey: orgRow.sport_key ?? null,
    modules: modules ?? [],
  };
}
