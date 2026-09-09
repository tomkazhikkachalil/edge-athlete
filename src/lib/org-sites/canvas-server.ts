import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from '@/lib/orgs/authz';
import { FEATURE_FLAGS } from '@/lib/features';
import { deriveLegacyLayout, newInstanceFor, validateLayout, type SiteLayout } from '@/lib/site-builder/layout';
import { isWebWidgetKey, type WebWidgetKey } from '@/lib/site-builder/catalog';
import { isWidgetEmpty } from '@/lib/site-builder/emptiness';
import { LayoutSchema, parseStoredLayout } from '@/lib/site-builder/layout-schema';
import { overlaySnapshot } from '@/lib/site-builder/snapshot';
import { getSiteBySlugAnyStatus, type PublicSite } from './server';
import { loadDraftSnapshot, loadSitePointers, writeDraftLayout } from './revisions-server';
import { rawSiteReaders, resolveHomeData } from './widget-data';
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
 * Both are SURFACE-gated by FEATURE_SITE_BUILDER (404 when off) and manager-
 * gated (`manage_site`) in their routes. The public renderer never reads the
 * flag: it renders whatever layout it is given.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export interface CanvasResponse {
  site: PublicSite;
  layout: SiteLayout;
  /** null = no draft yet (the layout is the linear projection); the first PUT creates it. */
  draft: { id: string; rev: number; hasUnpublishedChanges: boolean } | null;
  data: SiteHomeData;
  resolvedAt: string;
}

const NOT_AVAILABLE = () => NextResponse.json({ error: 'Not available' }, { status: 404 });

/** The draft view of an org's site by org id — the console side of
 *  getDraftSiteBySlug (the preview's read). */
async function loadDraftSiteView(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<{ site: PublicSite; layout: SiteLayout; draft: CanvasResponse['draft'] } | null> {
  const { site: pointers } = await loadSitePointers(admin, side, orgId);
  if (!pointers) return null;
  const base = await getSiteBySlugAnyStatus(admin, pointers.subdomain);
  if (!base) return null;
  const state = pointers.draft_revision_id ? await loadDraftSnapshot(admin, pointers) : null;
  const view = state ? overlaySnapshot(base, state.snapshot) : base;
  const stored = state ? parseStoredLayout(state.snapshot.layout) : null;
  return {
    site: view,
    layout: stored ?? deriveLegacyLayout(view),
    draft: state ? { id: state.summary.id, rev: state.summary.rev, hasUnpublishedChanges: state.summary.hasUnpublishedChanges } : null,
  };
}

export async function canvasGET(admin: Admin, side: OrgSide, orgId: string): Promise<NextResponse> {
  if (!FEATURE_FLAGS.FEATURE_SITE_BUILDER) return NOT_AVAILABLE();
  const view = await loadDraftSiteView(admin, side, orgId);
  if (!view) return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  const data = await resolveHomeData(rawSiteReaders(admin, view.site), view.site, view.layout);
  const body: CanvasResponse = { site: view.site, layout: view.layout, draft: view.draft, data, resolvedAt: new Date().toISOString() };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function draftLayoutPUT(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  userId: string,
  body: unknown
): Promise<NextResponse> {
  if (!FEATURE_FLAGS.FEATURE_SITE_BUILDER) return NOT_AVAILABLE();
  const envelope = body && typeof body === 'object' ? (body as { layout?: unknown; baseRev?: unknown }) : {};
  const parsed = LayoutSchema.safeParse(envelope.layout);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid layout', issues: parsed.error.issues.slice(0, 10).map(i => ({ path: i.path.join('.'), message: i.message })) }, { status: 400 });
  }
  const layout = parsed.data as SiteLayout;
  const issues = validateLayout(layout);
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
  if (!FEATURE_FLAGS.FEATURE_SITE_BUILDER) return NOT_AVAILABLE();
  const keys = (keysParam ?? '')
    .split(',')
    .map(k => k.trim())
    .filter((k): k is WebWidgetKey => isWebWidgetKey(k));
  if (keys.length === 0 || keys.length > 20) return NextResponse.json({ error: 'keys: 1–20 web widget keys' }, { status: 400 });
  const view = await loadDraftSiteView(admin, side, orgId);
  if (!view) return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  const synthetic: SiteLayout = {
    version: 1,
    cols: 12,
    widgets: keys.map(key => newInstanceFor(view.site, key, `probe:${key}`)),
  };
  const data = await resolveHomeData(rawSiteReaders(admin, view.site), view.site, synthetic);
  const empty = Object.fromEntries(synthetic.widgets.map(w => [w.key, isWidgetEmpty(w, data)]));
  return NextResponse.json({ data, empty, resolvedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'private, no-store' } });
}
