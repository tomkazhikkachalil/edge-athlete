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

/** The console read: this org's site (draft or published), or null. */
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
  return NextResponse.json({ site: data ?? null });
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

/** Publish/unpublish. Publishing stamps published_at once; unpublish
 *  clears it (the public routes 404 again). */
export async function sitePATCH(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  action: 'publish' | 'unpublish'
): Promise<NextResponse> {
  const { data: updated, error } = await admin
    .from('org_sites')
    .update({ published_at: action === 'publish' ? new Date().toISOString() : null })
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
  // immediate, not 300s-stale — the preview-then-publish flow).
  revalidateTag(`org-site:${updated[0].subdomain}`, { expire: 0 });
  return NextResponse.json({ site: updated[0] });
}

export interface PublicSite extends SiteRow {
  orgName: string;
  side: OrgSide;
  orgId: string;
  modules: { module_key: string; enabled: boolean; sort_order: number; config: unknown }[];
}

/** The (public) segment's read: a PUBLISHED site by slug, with its org
 *  name and ordered modules. Viewer-independent by construction —
 *  nothing here may branch on a session (the standings contract). */
export async function getPublicSiteBySlug(
  admin: Admin,
  slug: string
): Promise<PublicSite | null> {
  if (!isValidSubdomain(slug.toLowerCase())) return null;
  const { data: site, error } = await admin
    .from('org_sites')
    .select(SITE_FIELDS)
    .ilike('subdomain', slug)
    .not('published_at', 'is', null)
    .maybeSingle();
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
      .select('id, name')
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

  return {
    ...(site as SiteRow),
    orgName: org.name as string,
    side,
    orgId,
    modules: modules ?? [],
  };
}
