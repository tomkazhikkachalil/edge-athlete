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
  DEFAULT_MODULE_ORDER,
  isMissingTableError,
  isValidSubdomain,
  MODULE_KEYS,
  parseNavConfig,
  POST_155_MODULE_KEYS,
  slugifyOrgName,
  type SitePatchInput,
} from './validate';
import { RESERVED_ROOT_SLUGS } from './reserved';
import { judgeSlug, suggestSlugs, type OrgIdentity } from './slug-policy';

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
  /** Phase 6b C1 (171) — absent on a pre-171 read. */
  custom_domain?: string | null;
  domain_active_at?: string | null;
}

const SITE_FIELDS_BASE =
  'id, league_id, club_id, subdomain, template_id, theme_token_set, nav_config, logo_path, hero_config, contact_config, published_at';
// Phase 6b C1: the render seam needs the active custom domain; pre-171
// databases lack the columns, so every reader retries on 42703.
const SITE_FIELDS = `${SITE_FIELDS_BASE}, custom_domain, domain_active_at`;

/** Mint a free subdomain from the org name: base, then base-2..base-20.
 *  Reserved (shared denylist) and taken labels are skipped. */
export async function mintSubdomain(admin: Admin, orgName: string): Promise<string | null> {
  const base = slugifyOrgName(orgName);
  const candidates = [base, ...Array.from({ length: 19 }, (_, i) => `${base}-${i + 2}`)]
    .map(c => c.slice(0, 63))
    .filter(isValidSubdomain)
    // Phase 6 R1: slugs are ROOT URL paths now — the app-side reserved
    // set blocks route collisions even before migration 166 seeds the DB
    // list (degrade-first).
    .filter(c => !RESERVED_ROOT_SLUGS.has(c));
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
  let { data, error } = await admin
    .from('org_sites')
    .select(SITE_FIELDS)
    .eq(orgColumn(side), orgId)
    .maybeSingle();
  if (error?.code === '42703') {
    ({ data, error } = await admin
      .from('org_sites')
      .select(SITE_FIELDS_BASE)
      .eq(orgColumn(side), orgId)
      .maybeSingle());
  }
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

/** The org's identity for the slug engine (phase 6 R1) — name + sport +
 *  location off the org row itself (113/117 shape). */
async function loadOrgIdentity(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<OrgIdentity | null> {
  const { data } = await admin
    .from(side === 'league' ? 'leagues' : 'clubs')
    .select('name, sport_key, city, region')
    .eq('id', orgId)
    .maybeSingle();
  if (!data) return null;
  return {
    name: data.name as string,
    sportKey: (data.sport_key as string | null) ?? null,
    city: (data.city as string | null) ?? null,
    region: (data.region as string | null) ?? null,
  };
}

/** Availability = format + app-side reserved set + reserved_handles +
 *  org_sites uniqueness. Pure-ish helper shared by the options endpoint
 *  and the create path. */
async function slugAvailability(
  admin: Admin,
  slug: string
): Promise<'available' | 'reserved' | 'taken' | 'invalid'> {
  if (!isValidSubdomain(slug)) return 'invalid';
  if (RESERVED_ROOT_SLUGS.has(slug)) return 'reserved';
  const [{ data: reserved }, { data: taken }] = await Promise.all([
    admin.from('reserved_handles').select('handle').eq('handle', slug).maybeSingle(),
    admin.from('org_sites').select('id').eq('subdomain', slug).maybeSingle(),
  ]);
  if (reserved) return 'reserved';
  if (taken) return 'taken';
  return 'available';
}

/** The slug engine (phase 6 R1, Tom's ask): suggestions composed from
 *  the org's own identity, plus a verdict on a typed candidate. The
 *  anti-squatting policy lives in slug-policy.ts; refused slugs never
 *  reach the create path. */
export async function slugOptionsGET(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  candidate: string | null
): Promise<NextResponse> {
  const identity = await loadOrgIdentity(admin, side, orgId);
  if (!identity) return NextResponse.json({ error: 'Organization not found' }, { status: 404 });

  const raw = suggestSlugs(identity);
  const suggestions: { slug: string; available: boolean }[] = [];
  for (const slug of raw) {
    suggestions.push({ slug, available: (await slugAvailability(admin, slug)) === 'available' });
  }

  let candidateReport: {
    slug: string;
    availability: string;
    verdict: string;
    reason?: string;
  } | null = null;
  if (candidate) {
    const slug = candidate.toLowerCase().trim();
    const availability = await slugAvailability(admin, slug);
    const judged = judgeSlug(slug, identity);
    candidateReport = {
      slug,
      availability,
      verdict: judged.verdict,
      ...(judged.verdict !== 'ok' ? { reason: judged.reason } : {}),
    };
  }
  return NextResponse.json({ suggestions, candidate: candidateReport });
}

/** Create-with-defaults: mint the subdomain, insert the site + all nine
 *  module rows (one homogeneous batch — the PGRST102 rule), draft state.
 *  An existing site answers 409 (one per org, DB-enforced too).
 *  Phase 6 R1: an explicitly requested slug wins over the minted one —
 *  format/reserved/availability-checked and policy-judged (refused →
 *  400 with the reason; 'flagged' proceeds — the dashboard derives the
 *  flagged list, storage-free). */
export async function siteCreatePOST(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  orgName: string,
  requestedSlug?: string | null
): Promise<NextResponse> {
  const { data: existing } = await admin
    .from('org_sites')
    .select('id')
    .eq(orgColumn(side), orgId)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: 'This organization already has a site' }, { status: 409 });
  }

  let subdomain: string | null = null;
  if (requestedSlug) {
    const slug = requestedSlug.toLowerCase().trim();
    const availability = await slugAvailability(admin, slug);
    if (availability !== 'available') {
      const msg =
        availability === 'invalid'
          ? 'That address has an invalid format (lowercase letters, digits and hyphens)'
          : availability === 'reserved'
            ? 'That address is reserved'
            : 'That address is already taken';
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const identity = await loadOrgIdentity(admin, side, orgId);
    const judged = identity ? judgeSlug(slug, identity) : { verdict: 'ok' as const };
    if (judged.verdict === 'refused') {
      return NextResponse.json({ error: judged.reason }, { status: 400 });
    }
    subdomain = slug;
  } else {
    subdomain = await mintSubdomain(admin, orgName);
  }
  if (!subdomain) {
    return NextResponse.json(
      { error: 'Could not derive a web address from the organization name' },
      { status: 400 }
    );
  }

  const { data: site, error } = await admin
    .from('org_sites')
    .insert({ [orgColumn(side)]: orgId, subdomain })
    // A fresh site has no domain — the base list keeps create working on a
    // pre-171 database (the 42703 retry lives on the read paths).
    .select(SITE_FIELDS_BASE)
    .single();
  if (error || !site) {
    if (error?.code === '23505') {
      return NextResponse.json({ error: 'This organization already has a site' }, { status: 409 });
    }
    console.error(`${TAG} site insert error:`, error);
    return NextResponse.json({ error: 'Failed to create the site' }, { status: 500 });
  }

  const moduleRows = (keys: readonly string[]) =>
    keys.map(key => ({
      site_id: site.id,
      module_key: key,
      enabled: true,
      // G3: the side's recommended order (club ≠ league — Tom's principle 1).
      sort_order: DEFAULT_MODULE_ORDER[side].indexOf(key as (typeof MODULE_KEYS)[number]),
      config: {},
    }));
  let { error: modulesError } = await admin
    .from('org_site_modules')
    .insert(moduleRows(MODULE_KEYS));
  // Pre-migration retry ladder: the CHECK on an older database doesn't
  // know the newest keys — strip POST_155_MODULE_KEYS from the end
  // (newest first) until the insert fits. Site creation never breaks on
  // migration ordering.
  for (
    let stripFrom = POST_155_MODULE_KEYS.length - 1;
    modulesError?.code === '23514' && stripFrom >= 0;
    stripFrom--
  ) {
    const stripped = new Set<string>(POST_155_MODULE_KEYS.slice(stripFrom));
    ({ error: modulesError } = await admin
      .from('org_site_modules')
      .insert(moduleRows(MODULE_KEYS.filter(k => !stripped.has(k)))));
  }
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
  if (input.action === 'set_hero') {
    // S1: the hero photo is a site IMAGE asset — the set_sponsors recipe:
    // load the site first so the stored path can be re-asserted against
    // THIS site's prefix (the cross-site guard the schema can't apply).
    const { data: site } = await admin
      .from('org_sites')
      .select('id, subdomain')
      .eq(orgColumn(side), orgId)
      .maybeSingle();
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    if (input.imagePath && !input.imagePath.startsWith(`org-media/${site.id}/`)) {
      return NextResponse.json({ error: 'Photo is not one of this site’s assets' }, { status: 400 });
    }
    // Whole-object replace — the console always sends every field,
    // seeded from GET (a partial save would otherwise clear the rest).
    const hero_config = {
      ...(input.headline ? { headline: input.headline } : {}),
      ...(input.tagline ? { tagline: input.tagline } : {}),
      ...(input.imagePath ? { imagePath: input.imagePath } : {}),
      ...(input.imagePath && input.imageAlt ? { imageAlt: input.imageAlt } : {}),
      ...(input.ctaLabel && input.ctaUrl ? { ctaLabel: input.ctaLabel, ctaUrl: input.ctaUrl } : {}),
      ...(input.notice ? { notice: input.notice } : {}),
      ...(input.notice && input.noticeUntil ? { noticeUntil: input.noticeUntil } : {}),
    };
    const { error } = await admin.from('org_sites').update({ hero_config }).eq('id', site.id);
    if (error) {
      console.error(`${TAG} hero patch error:`, error);
      return NextResponse.json({ error: 'Failed to update the site' }, { status: 500 });
    }
    revalidateTag(`org-site:${site.subdomain}`, { expire: 0 });
    return NextResponse.json({ ok: true });
  }

  if (input.action === 'set_theme' || input.action === 'set_contact') {
    const patch =
      input.action === 'set_contact'
          ? {
              // Deliberately public, manager-entered org contact info.
              contact_config: {
                ...(input.email ? { email: input.email } : {}),
                ...(input.phone ? { phone: input.phone } : {}),
                ...(input.website ? { website: input.website } : {}),
                // S1: the golf club's contact card.
                ...(input.address && input.address.length ? { address: input.address } : {}),
                ...(input.hours ? { hours: input.hours } : {}),
                ...(input.directionsUrl ? { directionsUrl: input.directionsUrl } : {}),
                ...(input.social && Object.values(input.social).some(Boolean)
                  ? {
                      social: Object.fromEntries(
                        Object.entries(input.social).filter(([, v]) => typeof v === 'string' && v)
                      ),
                    }
                  : {}),
              },
            }
          : // null clears back to the violet defaults. Whole-object replace on
            // every branch — the console always sends every field, seeded
            // from GET (a partial save would otherwise clear the rest).
            // Phase 6b B1: the full token set rides the same replace.
            {
              theme_token_set: {
                ...(input.accent ? { accent: input.accent.toLowerCase() } : {}),
                ...(input.accentStrong ? { accentStrong: input.accentStrong.toLowerCase() } : {}),
                ...(input.surface && input.surface !== 'plain' ? { surface: input.surface } : {}),
                ...(input.typeface && input.typeface !== 'sans' ? { typeface: input.typeface } : {}),
                ...(input.wordmark ? { wordmark: input.wordmark } : {}),
              },
            };
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

  if (input.action === 'set_documents') {
    // Phase 6b B3 — the set_sponsors recipe: cross-site guard on stored
    // PDFs, UPDATE-then-insert on the module row (never upsert).
    const { data: site } = await admin
      .from('org_sites')
      .select('id, subdomain')
      .eq(orgColumn(side), orgId)
      .maybeSingle();
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }
    for (const doc of input.documents) {
      if (doc.path && !doc.path.startsWith(`org-media/${site.id}/`)) {
        return NextResponse.json(
          { error: 'Document is not one of this site’s files' },
          { status: 400 }
        );
      }
    }
    const { data: updated, error } = await admin
      .from('org_site_modules')
      .update({ config: { documents: input.documents } })
      .eq('site_id', site.id)
      .eq('module_key', 'documents')
      .select('module_key');
    if (error) {
      console.error(`${TAG} documents patch error:`, error);
      return NextResponse.json({ error: 'Failed to update documents' }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      const { error: insertError } = await admin.from('org_site_modules').insert({
        site_id: site.id,
        module_key: 'documents',
        enabled: true,
        sort_order: MODULE_KEYS.indexOf('documents'),
        config: { documents: input.documents },
      });
      if (insertError) {
        console.error(`${TAG} documents insert error:`, insertError);
        return NextResponse.json({ error: 'Failed to update documents' }, { status: 500 });
      }
    }
    revalidateTag(`org-site:${site.subdomain}`, { expire: 0 });
    return NextResponse.json({ ok: true });
  }

  if (input.action === 'set_template') {
    // Phase 6b B2: the id is a render decision; the CHECK (170) admits it.
    // Pre-170 the old CHECK rejects 'bold' with 23514 → a friendly 409.
    const { data: updated, error } = await admin
      .from('org_sites')
      .update({ template_id: input.templateId })
      .eq(orgColumn(side), orgId)
      .select('id, subdomain');
    if (error) {
      if (error.code === '23514') {
        return NextResponse.json(
          { error: 'This template needs a database migration first (170)' },
          { status: 409 }
        );
      }
      console.error(`${TAG} template patch error:`, error);
      return NextResponse.json({ error: 'Failed to update the template' }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }
    revalidateTag(`org-site:${updated[0].subdomain}`, { expire: 0 });
    return NextResponse.json({ ok: true });
  }

  if (input.action === 'reset_order') {
    // G3: back to the side's recommended order — per-row UPDATE (never
    // upsert), nav order cleared, nav LABELS kept.
    const { data: site } = await admin
      .from('org_sites')
      .select('id, subdomain, nav_config')
      .eq(orgColumn(side), orgId)
      .maybeSingle();
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }
    const order = DEFAULT_MODULE_ORDER[side];
    for (let i = 0; i < order.length; i++) {
      const { error: orderError } = await admin
        .from('org_site_modules')
        .update({ sort_order: i })
        .eq('site_id', site.id)
        .eq('module_key', order[i]);
      if (orderError) console.error(`${TAG} reset_order patch error:`, orderError);
    }
    const labels = parseNavConfig(site.nav_config).labels;
    const navConfig = order
      .filter(key => labels[key])
      .map(key => ({ key, label: labels[key] }));
    const { error } = await admin.from('org_sites').update({ nav_config: navConfig }).eq('id', site.id);
    if (error) {
      console.error(`${TAG} reset_order nav error:`, error);
      return NextResponse.json({ error: 'Failed to reset the layout' }, { status: 500 });
    }
    revalidateTag(`org-site:${site.subdomain}`, { expire: 0 });
    return NextResponse.json({ ok: true });
  }

  if (input.action === 'set_nav') {
    // Phase 6b B1: nav_config (labels + display order) AND the module
    // rows' sort_order follow the same list — per-row UPDATE, never
    // upsert (an upsert would clobber enabled/config). Unlisted modules
    // keep their sort_order; hero stays first at MODULE_KEYS index 0.
    const { data: site } = await admin
      .from('org_sites')
      .select('id, subdomain')
      .eq(orgColumn(side), orgId)
      .maybeSingle();
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }
    const seen = new Set<string>();
    const items = input.items.filter(i => (seen.has(i.key) ? false : (seen.add(i.key), true)));
    const navConfig = items.map(i => ({ key: i.key, ...(i.label ? { label: i.label } : {}) }));
    const { error } = await admin
      .from('org_sites')
      .update({ nav_config: navConfig })
      .eq('id', site.id);
    if (error) {
      console.error(`${TAG} nav patch error:`, error);
      return NextResponse.json({ error: 'Failed to update the navigation' }, { status: 500 });
    }
    for (let i = 0; i < items.length; i++) {
      const { error: orderError } = await admin
        .from('org_site_modules')
        .update({ sort_order: i + 1 })
        .eq('site_id', site.id)
        .eq('module_key', items[i].key);
      if (orderError) console.error(`${TAG} sort_order patch error:`, orderError);
    }
    revalidateTag(`org-site:${site.subdomain}`, { expire: 0 });
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
  const read = (fields: string) => {
    let query = admin.from('org_sites').select(fields).ilike('subdomain', slug);
    if (!includeDrafts) query = query.not('published_at', 'is', null);
    return query.maybeSingle();
  };
  let { data: siteData, error } = await read(SITE_FIELDS);
  if (error?.code === '42703') ({ data: siteData, error } = await read(SITE_FIELDS_BASE));
  // The dynamic select string defeats supabase-js's type parser; cast once.
  const site = siteData as unknown as SiteRow | null;
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
    ...site,
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
