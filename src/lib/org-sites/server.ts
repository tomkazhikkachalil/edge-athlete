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
import { isListed, listingFromRow } from '@/lib/orgs/listing';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from '@/lib/orgs/authz';
import {
  defaultModuleOrder,
  GOLF_TAGLINE,
  isMissingTableError,
  isValidSubdomain,
  MODULE_KEYS,
  POST_155_MODULE_KEYS,
  slugifyOrgName,
  type SitePatchInput,
} from './validate';
import { RESERVED_ROOT_SLUGS } from './reserved';
import { judgeSlug, suggestSlugs, type OrgIdentity } from './slug-policy';
import { applyDraftAction, loadDraftSnapshot, loadSitePointers, publishDraft } from './revisions-server';
import { readGalleryPicks } from './member-photo-gate';
import { overlaySnapshot, parseSnapshot, type SnapshotAction } from '@/lib/site-builder/snapshot';
import { parseStoredLayout } from '@/lib/site-builder/layout-schema';
import type { SiteLayout } from '@/lib/site-builder/layout';

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
// Site Builder phase 2 (180): the console read also wants the two revision
// pointers; pre-180 databases step down to SITE_FIELDS on 42703.
const SITE_FIELDS_180 = `${SITE_FIELDS}, draft_revision_id, published_revision_id`;

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
  // Site Builder phase 2 (180): the two revision pointers ride the same
  // read with one more 42703 step-down, so a pre-180 database answers
  // `revisions: { supported: false }` and everything else as before.
  let revisionsSupported = true;
  let { data, error } = await admin
    .from('org_sites')
    .select(SITE_FIELDS_180)
    .eq(orgColumn(side), orgId)
    .maybeSingle();
  if (error?.code === '42703') {
    revisionsSupported = false;
    ({ data, error } = await admin
      .from('org_sites')
      .select(SITE_FIELDS)
      .eq(orgColumn(side), orgId)
      .maybeSingle());
  }
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
  if (!data) return NextResponse.json({ site: null, modules: [], draft: null, publishedRevisionId: null, revisions: { supported: revisionsSupported } });
  const { data: modules } = await admin
    .from('org_site_modules')
    .select('module_key, enabled, sort_order, config')
    .eq('site_id', data.id)
    .order('sort_order', { ascending: true })
    .limit(20);
  // P2-B: the console reads the DRAFT view — `site`/`modules` overlaid with
  // the draft snapshot when one exists (so every form seeds from what the
  // manager is editing), plus the draft line; row-only fields (published_at,
  // logo_path, the domain columns) always come from the row. The pointer
  // columns never leave the server.
  const row = data as unknown as SiteRow & { draft_revision_id?: string | null; published_revision_id?: string | null };
  const { draft_revision_id, published_revision_id, ...site } = row;
  const draftState = revisionsSupported
    ? await loadDraftSnapshot(admin, {
        id: site.id,
        subdomain: site.subdomain,
        published_at: site.published_at,
        draft_revision_id: draft_revision_id ?? null,
        published_revision_id: published_revision_id ?? null,
      })
    : null;
  const view = draftState
    ? overlaySnapshot({ ...site, modules: (modules ?? []) as { module_key: string; enabled: boolean; sort_order: number; config: unknown }[] }, draftState.snapshot)
    : { ...site, modules: modules ?? [] };
  const { modules: viewModules, ...viewSite } = view;
  return NextResponse.json({
    site: viewSite,
    modules: viewModules,
    draft: draftState?.summary ?? null,
    publishedRevisionId: published_revision_id ?? null,
    revisions: { supported: revisionsSupported },
  });
}

/** Phase 7 C3: the org's shaping sport — leagues.sport_key, clubs.primary_sport
 *  (174). A pre-174 database (42703) or an org without one → null, which
 *  every caller treats as "the classic shape". */
export async function loadOrgSport(admin: Admin, side: OrgSide, orgId: string): Promise<string | null> {
  const column = side === 'league' ? 'sport_key' : 'primary_sport';
  const { data, error } = await admin
    .from(side === 'league' ? 'leagues' : 'clubs')
    .select(column)
    .eq('id', orgId)
    .maybeSingle();
  if (error || !data) return null;
  const value = (data as Record<string, unknown>)[column];
  return typeof value === 'string' && value ? value : null;
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

  // C3: the org's sport shapes the site from day one — the golf order and
  // the golf tagline (plain hero_config data the manager edits freely).
  const sportKey = await loadOrgSport(admin, side, orgId);
  const order = defaultModuleOrder(side, sportKey);
  const { data: site, error } = await admin
    .from('org_sites')
    .insert({
      [orgColumn(side)]: orgId,
      subdomain,
      ...(sportKey === 'golf' ? { hero_config: { tagline: GOLF_TAGLINE } } : {}),
    })
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
      // R5: the members table is a golf surface (rounds) — enabled for golf
      // orgs, seeded off elsewhere (managers can toggle it on).
      enabled: key === 'members' ? sportKey === 'golf' : true,
      // G3: the side's recommended order (club ≠ league — Tom's principle 1);
      // C3: the sport's shape when the org has one.
      sort_order: order.indexOf(key as (typeof MODULE_KEYS)[number]),
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
  input: SitePatchInput,
  userId: string | null = null
): Promise<NextResponse> {
  // ── Site live / offline (the org's identity act, manage_org) ─────────────
  if (input.action === 'publish' || input.action === 'unpublish') {
    const { data: current } = await admin
      .from('org_sites')
      .select('id, subdomain, published_at')
      .eq(orgColumn(side), orgId)
      .maybeSingle();
    if (!current) return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    // Onboarding v2 R1 (179): publishing no longer waits for approval — an
    // org is live by link; an unlisted/pending site serves noindex and stays
    // out of the directory, the sitemap and search until it is LISTED.
    // P2-B: idempotent on the stamp — going live keeps an existing one.
    const { data: updated, error } = await admin
      .from('org_sites')
      .update({ published_at: input.action === 'publish' ? (current.published_at ?? new Date().toISOString()) : null })
      .eq('id', current.id)
      .select('id, subdomain, published_at');
    if (error) {
      console.error(`${TAG} site patch error:`, error);
      return NextResponse.json({ error: 'Failed to update the site' }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }
    // P2-B: going live PROMOTES a dirty draft — preview-then-publish is the
    // moment a first-time manager means "this is what I saw". Offline leaves
    // the draft alone. Pre-180 there is no draft to promote.
    if (input.action === 'publish') {
      const { site: pointers, support } = await loadSitePointers(admin, side, orgId);
      if (support === 'supported' && pointers?.draft_revision_id) {
        const promoted = await publishDraft(admin, pointers, userId);
        if (promoted.status === 'error') {
          return NextResponse.json({ error: 'Failed to publish the draft' }, { status: 500 });
        }
        if (promoted.status === 'template_check') {
          return NextResponse.json({ error: 'This template needs a database migration first (170)' }, { status: 409 });
        }
      }
    }
    // The ISR documents re-render on the next hit (publish must be
    // immediate, not 300s-stale — the preview-then-publish flow). The
    // sitemap enumerator purges too (R4): a published site must enter
    // /sitemap.xml immediately, an unpublished one must leave it.
    revalidateTag(`org-site:${updated[0].subdomain}`, { expire: 0 });
    revalidateTag('org-sitemap', { expire: 0 });
    return NextResponse.json({ site: updated[0] });
  }

  // ── Content actions → the DRAFT (P2-B), or today's live write pre-180 ────
  // The guards the schema cannot apply stay here, BEFORE the write: every
  // stored asset path must live under THIS site's prefix (the cross-site
  // guard), and a gallery pick must pass the member-photo gate.
  const { data: site } = await admin
    .from('org_sites')
    .select('id, subdomain')
    .eq(orgColumn(side), orgId)
    .maybeSingle();
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  const ownPrefix = `org-media/${site.id}/`;
  const foreign = (message: string) => NextResponse.json({ error: message }, { status: 400 });

  let action: SnapshotAction;
  switch (input.action) {
    case 'set_hero':
      if (input.imagePath && !input.imagePath.startsWith(ownPrefix)) return foreign('Photo is not one of this site’s assets');
      action = input;
      break;
    case 'set_sponsors':
      for (const sponsor of input.sponsors) {
        if (sponsor.logoPath && !sponsor.logoPath.startsWith(ownPrefix)) return foreign('Logo is not one of this site’s assets');
      }
      action = input;
      break;
    case 'set_documents':
      for (const doc of input.documents) {
        if (doc.path && !doc.path.startsWith(ownPrefix)) return foreign('Document is not one of this site’s files');
      }
      action = input;
      break;
    case 'set_course_photo':
      if (input.path && !input.path.startsWith(ownPrefix)) return foreign('Photo is not one of this site’s assets');
      action = input;
      break;
    case 'set_gallery_pick': {
      // M2: the member-photo gate re-runs BEFORE a pick is stored (the site
      // need not be live yet; nothing streams until it is, and public).
      const { evaluateMemberPhotos } = await import('./member-photo-gate');
      const [eligible] = await evaluateMemberPhotos(admin, site.id, [input.mediaId], { requirePick: false, requireLive: false });
      if (!eligible) {
        return NextResponse.json(
          { error: 'That photo can’t go on the site: it must be on a member’s public round post, and the member must have opted in' },
          { status: 400 }
        );
      }
      action = {
        action: 'set_gallery_pick',
        pick: { mediaId: eligible.mediaId, postId: eligible.postId, profileId: eligible.profileId, addedAt: new Date().toISOString() },
      };
      break;
    }
    case 'remove_gallery_pick':
      action = { action: 'remove_gallery_pick', mediaId: input.mediaId };
      break;
    default:
      // publish/unpublish returned above; the remaining members are content actions.
      action = input as SnapshotAction;
  }

  const ctx = {
    side,
    // reset_order is the one action that needs the org's sport (the
    // recommended order is sport-shaped); the read is skipped otherwise.
    sportKey: input.action === 'reset_order' ? await loadOrgSport(admin, side, orgId) : null,
  };
  const result = await applyDraftAction(admin, side, orgId, userId, action, ctx);
  switch (result.status) {
    case 'not_found':
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    case 'conflict':
      return NextResponse.json({ error: 'The draft changed while you were editing — reload and try again' }, { status: 409 });
    case 'error':
      return NextResponse.json({ error: 'Failed to update the site' }, { status: 500 });
    default:
      break;
  }
  const draft = result.draft ?? null;
  // Response shapes are the pre-P2-B ones plus `draft` (the console's line).
  if (input.action === 'set_module') {
    return NextResponse.json({ module: { module_key: input.moduleKey, enabled: input.enabled }, draft });
  }
  if (input.action === 'set_gallery_pick' || input.action === 'remove_gallery_pick') {
    const picks = result.snapshot ? readGalleryPicks(result.snapshot.modules.gallery?.config).length : 0;
    return NextResponse.json({ ok: true, picks, draft });
  }
  return NextResponse.json({ ok: true, draft });
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
  /** C3: the sport that SHAPES the site — leagues.sport_key or
   *  clubs.primary_sport (174; null pre-174 or when unset). Picks the
   *  sport titles and the golf tagline fallback at render. */
  sportKey: string | null;
  /** Phase 9 V4: a PRIVATE club's site shows identity + public items only;
   *  members-only modules render a panel (decided from this field alone —
   *  the (public) segment never reads a session). Leagues: public. */
  visibility: 'public' | 'private';
  /** Onboarding v2 R1 (179): LISTED = in the directory, the sitemap and
   *  the index. Unlisted/pending sites serve — by link — with noindex, an
   *  empty per-site sitemap and a disallowing robots.txt. Pre-179 derives
   *  from approved_at; pre-174 reads listed. */
  listed: boolean;
  /** The org record's description (R5 renders it under the hero). */
  orgDescription: string | null;
  modules: { module_key: string; enabled: boolean; sort_order: number; config: unknown }[];
  /** Site Builder P3-C: the revision's stored grid layout — the PUBLISHED
   *  revision's for public reads, the DRAFT's for the draft view (the
   *  preview, the canvas). Null = no stored layout yet: the renderer draws
   *  `layoutFromModules(site)`, the template-aware projection of the rows. */
  layout: SiteLayout | null;
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

/** P2-B — the DRAFT view for the token-gated preview: the any-status site
 *  with its draft snapshot overlaid (falls back to the rows without a draft
 *  or pre-180). Row-only fields stay the row's. */
export async function getDraftSiteBySlug(admin: Admin, slug: string): Promise<PublicSite | null> {
  const site = await getSiteBySlugInternal(admin, slug, true);
  if (!site) return null;
  const { data, error } = await admin.from('org_sites').select('draft_revision_id').eq('id', site.id).maybeSingle();
  if (error || !data?.draft_revision_id) return site;
  const state = await loadDraftSnapshot(admin, {
    id: site.id,
    subdomain: site.subdomain,
    published_at: site.published_at,
    draft_revision_id: data.draft_revision_id as string,
    published_revision_id: null,
  });
  if (!state) return site;
  return { ...overlaySnapshot(site, state.snapshot), layout: parseStoredLayout(state.snapshot.layout) };
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
  let { data: siteData, error } = await read(SITE_FIELDS_180);
  if (error?.code === '42703') ({ data: siteData, error } = await read(SITE_FIELDS));
  if (error?.code === '42703') ({ data: siteData, error } = await read(SITE_FIELDS_BASE));
  // The dynamic select string defeats supabase-js's type parser; cast once.
  const site = siteData as unknown as (SiteRow & { published_revision_id?: string | null; draft_revision_id?: string | null }) | null;
  if (error || !site) {
    if (error && !isMissingTableError(error.code)) {
      console.error(`${TAG} public site read error:`, error);
    }
    return null;
  }

  const side: OrgSide = site.league_id ? 'league' : 'club';
  const orgId = (site.league_id ?? site.club_id) as string;
  // R4 widens the org read for JSON-LD: geography both sides, sport_key
  // leagues only (clubs have no such column — mig 108/113); C3 adds the
  // club's primary_sport (174) with a 42703 retry for older databases.
  const readOrg = (fields: string) =>
    admin.from(side === 'league' ? 'leagues' : 'clubs').select(fields).eq('id', orgId).maybeSingle();
  const [orgRead, { data: modules }] = await Promise.all([
    readOrg(
      side === 'league'
        ? 'id, name, description, city, region, country, sport_key, visibility, listing_status, approved_at'
        : 'id, name, description, city, region, country, primary_sport, visibility, listing_status, approved_at'
    ),
    admin
      .from('org_site_modules')
      .select('module_key, enabled, sort_order, config')
      .eq('site_id', site.id)
      .order('sort_order', { ascending: true })
      .limit(20),
  ]);
  let org = orgRead.data;
  if (orgRead.error?.code === '42703') {
    // Pre-179 (no listing_status): the 176/177 shape; then pre-176/177 (no
    // visibility) or pre-174 (no primary_sport): step down.
    ({ data: org } = await readOrg(
      side === 'league'
        ? 'id, name, description, city, region, country, sport_key, visibility, approved_at'
        : 'id, name, description, city, region, country, primary_sport, visibility, approved_at'
    ));
    if (!org) ({ data: org } = await readOrg(side === 'league' ? 'id, name, city, region, country, sport_key' : 'id, name, city, region, country, primary_sport'));
    if (!org) ({ data: org } = await readOrg('id, name, city, region, country'));
  }
  if (!org) return null;

  // P3-C: the PUBLISHED revision's stored layout (the draft view swaps in
  // the draft's — getDraftSiteBySlug). Pre-180 or never published through
  // a revision → null → the projection.
  let layout: SiteLayout | null = null;
  if (site.published_revision_id) {
    const { data: rev } = await admin.from('org_site_revisions').select('snapshot').eq('id', site.published_revision_id).maybeSingle();
    const snap = rev ? parseSnapshot((rev as { snapshot: unknown }).snapshot) : null;
    layout = snap ? parseStoredLayout(snap.layout) : null;
  }
  const { published_revision_id: _published, draft_revision_id: _draft, ...siteFields } = site;
  void _published;
  void _draft;

  // The dynamic select string defeats supabase-js's type parser; cast once.
  const orgRow = org as unknown as {
    name: string;
    city?: string | null;
    region?: string | null;
    country?: string | null;
    sport_key?: string | null;
    primary_sport?: string | null;
    visibility?: string | null;
    description?: string | null;
    listing_status?: string | null;
    approved_at?: string | null;
  };
  return {
    ...siteFields,
    orgName: orgRow.name,
    side,
    orgId,
    orgCity: orgRow.city ?? null,
    orgRegion: orgRow.region ?? null,
    orgCountry: orgRow.country ?? null,
    orgSportKey: orgRow.sport_key ?? null,
    sportKey: (side === 'league' ? orgRow.sport_key : orgRow.primary_sport) ?? null,
    // Phase 9 V4 (leagues in program 11 L2): decided from the org row alone.
    visibility: orgRow.visibility === 'private' ? 'private' : 'public',
    // R1: decided from the org row alone (viewer-independent, like visibility).
    listed: isListed(listingFromRow(orgRow as unknown as Record<string, unknown>)),
    orgDescription: orgRow.description ?? null,
    modules: modules ?? [],
    layout,
  };
}
