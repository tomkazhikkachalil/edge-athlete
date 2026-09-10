import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from '@/lib/orgs/authz';
import { newInstanceFor, validateLayout, type SiteLayout } from '@/lib/site-builder/layout';
import { seedLayout } from '@/lib/site-builder/seeds';
import { canvasLayoutFor } from '@/lib/site-builder/canvas-layout';
import { isSiteWidgetKey, type SiteWidgetKey } from '@/lib/site-builder/catalog';
import { isWidgetEmpty } from '@/lib/site-builder/emptiness';
import { LayoutSchema, parseStoredLayout } from '@/lib/site-builder/layout-schema';
import { instanceImagePaths, instanceSchemaFor } from '@/lib/site-builder/schemas';
import { overlaySnapshot } from '@/lib/site-builder/snapshot';
import { getSiteBySlugAnyStatus, loadGalleryOrg, type PublicSite } from './server';
import type { GalleryOrg } from '@/lib/site-builder/gallery';
import { ORG_MEDIA_PREFIX } from './pages-server';
import { loadDraftSnapshot, loadSitePointers, writeDraftLayout } from './revisions-server';
import { rawSiteReaders, resolveHomeData } from './widget-data';
import { fetchCanvasOptions, type CanvasOptions } from './query-options';
import type { SiteHomeData } from './home-data';

/**
 * The editor's read and write — Site Builder P3-B (Sep 9 2026).
 *
 * GET …/site/canvas answers everything the canvas needs in one round: the
 * DRAFT view of the site (rows overlaid with the draft snapshot), the layout
 * it edits (the draft's stored `layout`, else the linear projection of the
 * module rows), the draft's `rev` (the optimistic-concurrency token the PUT
 * hands back) and the home data resolved with the RAW reader set against
 * that layout — the same resolver the public home and the preview use.
 *
 * PUT …/site/draft { layout, baseRev? } validates the envelope (LayoutSchema)
 * and the geometry (validateLayout: bounds, per-widget constraints, overlaps)
 * and writes it into the draft snapshot's `layout` slot, rev-guarded. Nothing
 * public is revalidated — the layout goes live with the draft, on publish.
 *
 * Manager-gated (`manage_site`) in their routes. The surface flag that once
 * 404'd these routes retired in P10-C: the editor is the Website section's
 * door. The public renderer never read it.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export interface CanvasResponse {
  site: PublicSite;
  layout: SiteLayout;
  /** null = no draft yet (the layout is the published one, else the seed); the first PUT creates it. */
  draft: { id: string; rev: number; hasUnpublishedChanges: boolean } | null;
  /** Phase 8: is the site live (org_sites.published_at)? The checklist's last step. */
  published: boolean;
  data: SiteHomeData;
  /** Phase 9: what a query widget can bind to (competitions, venues). */
  options: CanvasOptions;
  /** Phase 11: the org facts the gallery writes its previews from — the
   *  same the server applies, so a thumbnail never lies. */
  gallery: GalleryOrg;
  resolvedAt: string;
}


/** The draft view of an org's site by org id — the console side of
 *  getDraftSiteBySlug (the preview's read). */
async function loadDraftSiteView(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<{ site: PublicSite; layout: SiteLayout; draft: CanvasResponse['draft']; published: boolean } | null> {
  const { site: pointers } = await loadSitePointers(admin, side, orgId);
  if (!pointers) return null;
  const base = await getSiteBySlugAnyStatus(admin, pointers.subdomain);
  if (!base) return null;
  const state = pointers.draft_revision_id ? await loadDraftSnapshot(admin, pointers) : null;
  const view = state ? overlaySnapshot(base, state.snapshot) : base;
  const stored = state ? parseStoredLayout(state.snapshot.layout) : null;
  return {
    site: view,
    // The draft's layout; a draft WITHOUT one (a pre-grid restore) → its seed
    // (B1); no draft → the PUBLISHED one (phase 8 — a P3 gap: after a publish
    // there is no draft, and the canvas showed the projection); else the seed.
    layout: canvasLayoutFor({ hasDraft: !!state, stored, published: base.layout, seed: () => seedLayout(view) }),
    draft: state ? { id: state.summary.id, rev: state.summary.rev, hasUnpublishedChanges: state.summary.hasUnpublishedChanges } : null,
    published: !!pointers.published_at,
  };
}

export async function canvasGET(admin: Admin, side: OrgSide, orgId: string): Promise<NextResponse> {
  const view = await loadDraftSiteView(admin, side, orgId);
  if (!view) return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  const [data, options, gallery] = await Promise.all([
    resolveHomeData(rawSiteReaders(admin, view.site), view.site, view.layout),
    fetchCanvasOptions(admin, side, orgId),
    loadGalleryOrg(admin, side, orgId, { name: view.site.orgName, city: view.site.orgCity, region: view.site.orgRegion }),
  ]);
  const body: CanvasResponse = { site: view.site, layout: view.layout, draft: view.draft, published: view.published, data, options, gallery, resolvedAt: new Date().toISOString() };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function draftLayoutPUT(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  userId: string,
  body: unknown
): Promise<NextResponse> {
  const envelope = body && typeof body === 'object' ? (body as { layout?: unknown; baseRev?: unknown }) : {};
  const parsed = LayoutSchema.safeParse(envelope.layout);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid layout', issues: parsed.error.issues.slice(0, 10).map(i => ({ path: i.path.join('.'), message: i.message })) }, { status: 400 });
  }
  // B2: the schema takes any key string (an unknown key from a NEWER build
  // must not null a stored layout); a WRITE is strict — only site widgets.
  const foreign = parsed.data.widgets.filter(w => !isSiteWidgetKey(w.key));
  if (foreign.length > 0) {
    return NextResponse.json({ error: 'Invalid layout', issues: foreign.map(w => ({ id: w.id, message: `${w.key}: not a site widget` })) }, { status: 400 });
  }
  const layout = parsed.data as SiteLayout;
  const issues = validateLayout(layout);
  // Phase 5: each instance's OPTIONS (title ≤ 60 …); phase 6: a content
  // widget's content too (text blocks, the image, the embed structure).
  const imagePaths: { id: string; key: string; path: string }[] = [];
  for (const w of layout.widgets) {
    const opts = instanceSchemaFor(w.key).safeParse(w.config);
    if (!opts.success) {
      issues.push({ id: w.id, message: `${w.key}: ${opts.error.issues[0]?.message ?? 'invalid options'}` });
      continue;
    }
    for (const path of instanceImagePaths(w.key, opts.data)) imagePaths.push({ id: w.id, key: w.key, path });
  }
  if (imagePaths.length > 0) {
    // The cross-site guard (the pages-server precedent): every image an
    // instance refers to must live under THIS site's asset prefix.
    const { site } = await loadSitePointers(admin, side, orgId);
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    for (const p of imagePaths) {
      if (!p.path.startsWith(`${ORG_MEDIA_PREFIX}${site.id}/`)) issues.push({ id: p.id, message: `${p.key}: image is not one of this site’s assets` });
    }
  }
  if (issues.length > 0) return NextResponse.json({ error: 'Invalid layout', issues }, { status: 400 });
  const baseRev = typeof envelope.baseRev === 'number' && Number.isInteger(envelope.baseRev) ? envelope.baseRev : undefined;
  const result = await writeDraftLayout(admin, side, orgId, userId, layout, baseRev);
  switch (result.status) {
    case 'ok':
      return NextResponse.json({ ok: true, rev: result.rev });
    case 'conflict':
      return NextResponse.json({ error: 'The draft changed while you were editing — reload and try again' }, { status: 409 });
    case 'pre180':
      return NextResponse.json({ error: 'Drafts and revisions need a database migration first (180)' }, { status: 409 });
    case 'not_found':
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    default:
      return NextResponse.json({ error: 'Failed to save the layout' }, { status: 500 });
  }
}

/** P3-D — the picker's live tiles: the home data for widgets NOT yet on the
 *  layout, resolved with the raw reader set against a synthetic layout of
 *  fresh instances (default size, this site's config), plus each key's
 *  emptiness so the picker can say "Start a season to fill this". One call
 *  for every missing key: `?keys=a,b,c`. */
export async function widgetDataGET(admin: Admin, side: OrgSide, orgId: string, keysParam: string | null): Promise<NextResponse> {
  const keys = (keysParam ?? '')
    .split(',')
    .map(k => k.trim())
    .filter((k): k is SiteWidgetKey => isSiteWidgetKey(k));
  if (keys.length === 0 || keys.length > 20) return NextResponse.json({ error: 'keys: 1–20 site widget keys' }, { status: 400 });
  const view = await loadDraftSiteView(admin, side, orgId);
  if (!view) return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  const synthetic: SiteLayout = {
    version: 1,
    cols: 12,
    widgets: keys.map(key => newInstanceFor(view.site, key, `probe:${key}`)),
  };
  const data = await resolveHomeData(rawSiteReaders(admin, view.site), view.site, synthetic);
  const empty = Object.fromEntries(synthetic.widgets.map(w => [w.key, isWidgetEmpty(w, data, view.site)]));
  return NextResponse.json({ data, empty, resolvedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'private, no-store' } });
}
