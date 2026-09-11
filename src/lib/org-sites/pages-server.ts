// ── Org site pages CRUD — the shared core (phase 3 R3; program 2 B, Sep 11 2026)
// org_site_pages is posture A (service-role only); both route twins wrap
// these. Since program 2 B a page lives in the ONE revision snapshot
// (`snapshot.pages`) and the rows are its PUBLISHED PROJECTION: every write
// here goes through `applyDraftAction` (the one writer) — create →
// `add_page`, title / visibility → `set_page`, delete → `remove_page`, and a
// `body` PATCH converts to the page's LAYOUT (`pageLayoutFromBody`) so the
// console's block editor keeps working until it retires. Nothing here touches
// the rows or revalidates: the page goes live with the draft, on publish
// (pre-180 the one writer's live path still mirrors and purges). Reads answer
// the draft's pages when a draft exists, else the projection's.
//
// Image blocks are re-asserted against THIS site's org-media/ prefix at
// PATCH time — the schema alone can't scope a path to the site, and a
// cross-site reference must never render.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from '@/lib/orgs/authz';
import { ALLOWED_IMAGE_MIME } from '@/lib/media/validation';
import { isValidPageSlug, PAGES_PER_SITE_MAX, type PageCreateInput, type PagePatchInput } from './validate';
import { blocksFromPageLayout, orderedPages, pageLayoutFromBody, parsePageLayout, blankPageLayout, type SnapshotPage } from '@/lib/site-builder/pages';
import { applyDraftAction, loadDraftSnapshot, loadRows, loadSitePointers, rowsSnapshot, writeDraftLayout } from './revisions-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[ORG SITE PAGES]';
const MAX_ASSET_BYTES = 10 * 1024 * 1024;
export const ORG_MEDIA_PREFIX = 'org-media/';

function orgColumn(side: OrgSide): 'league_id' | 'club_id' {
  return side === 'league' ? 'league_id' : 'club_id';
}

async function getSiteForOrg(admin: Admin, side: OrgSide, orgId: string) {
  const { data } = await admin
    .from('org_sites')
    .select('id, subdomain')
    .eq(orgColumn(side), orgId)
    .maybeSingle();
  return data as { id: string; subdomain: string } | null;
}

/** The page row shape the console and the API have always read. `body` is
 *  DERIVED from the layout (the block editor's view of a converted or
 *  authored page); `layout` and `in_nav` ride beside it. */
export function pageRowOf(siteId: string, p: SnapshotPage) {
  const layout = parsePageLayout(p.layout) ?? blankPageLayout(p.id);
  return {
    id: p.id,
    site_id: siteId,
    slug: p.slug,
    title: p.title,
    body: blocksFromPageLayout(layout),
    visibility: p.visibility,
    created_at: p.createdAt,
    updated_at: p.createdAt,
    in_nav: p.inNav,
    layout,
  };
}

/** The pages as the manager sees them: the draft's when a draft exists,
 *  else the published projection's. Null when the site is missing. */
async function loadPagesView(admin: Admin, side: OrgSide, orgId: string): Promise<{ siteId: string; subdomain: string; pages: SnapshotPage[] } | null> {
  const { site: pointers, support } = await loadSitePointers(admin, side, orgId);
  if (!pointers) return null;
  const state = support === 'supported' && pointers.draft_revision_id ? await loadDraftSnapshot(admin, pointers) : null;
  if (state) return { siteId: pointers.id, subdomain: pointers.subdomain, pages: orderedPages(state.snapshot.pages) };
  const rows = await loadRows(admin, pointers.id);
  if (!rows) return null;
  return { siteId: pointers.id, subdomain: pointers.subdomain, pages: orderedPages(rowsSnapshot(rows).pages) };
}

const CTX = (side: OrgSide) => ({ side, sportKey: null });

export async function pagesGET(admin: Admin, side: OrgSide, orgId: string): Promise<NextResponse> {
  const view = await loadPagesView(admin, side, orgId);
  if (!view) return NextResponse.json({ pages: [] });
  return NextResponse.json({ pages: view.pages.map(p => pageRowOf(view.siteId, p)) });
}

export async function pageCreatePOST(admin: Admin, side: OrgSide, orgId: string, input: PageCreateInput, userId: string | null = null): Promise<NextResponse> {
  const view = await loadPagesView(admin, side, orgId);
  if (!view) return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  if (view.pages.length >= PAGES_PER_SITE_MAX) {
    return NextResponse.json({ error: `A site can have at most ${PAGES_PER_SITE_MAX} pages` }, { status: 400 });
  }
  // Explicit slug: reserved/invalid → 400; taken → 409 (the reducer refuses it as "no change").
  if (input.slug !== undefined && !isValidPageSlug(input.slug)) {
    return NextResponse.json({ error: 'That address is reserved or invalid' }, { status: 400 });
  }
  const id = crypto.randomUUID();
  const result = await applyDraftAction(admin, side, orgId, userId, { action: 'add_page', title: input.title, slug: input.slug, id, createdAt: new Date().toISOString() }, CTX(side));
  if (result.status === 'not_found') return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  if (result.status === 'conflict') return NextResponse.json({ error: 'The draft changed while you were editing — reload and try again' }, { status: 409 });
  if (result.status === 'error') return NextResponse.json({ error: 'Failed to create the page' }, { status: 500 });
  const page = result.snapshot?.pages?.[id];
  if (!page) {
    return NextResponse.json({ error: input.slug !== undefined ? 'That address is already in use' : 'Could not derive a free address from that title' }, { status: 409 });
  }
  return NextResponse.json({ page: pageRowOf(view.siteId, page), draft: result.draft ?? null });
}

export async function pageGET(admin: Admin, side: OrgSide, orgId: string, pageId: string): Promise<NextResponse> {
  const view = await loadPagesView(admin, side, orgId);
  const page = view?.pages.find(p => p.id === pageId);
  if (!view || !page) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ page: pageRowOf(view.siteId, page) });
}

export async function pagePATCH(admin: Admin, side: OrgSide, orgId: string, pageId: string, input: PagePatchInput, userId: string | null = null): Promise<NextResponse> {
  const view = await loadPagesView(admin, side, orgId);
  if (!view) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!view.pages.some(p => p.id === pageId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (input.body) {
    // The cross-site guard: every image path must live under THIS site's
    // asset prefix (the schema can't know the site id).
    for (const block of input.body) {
      if (block.type === 'image' && !block.path.startsWith(`${ORG_MEDIA_PREFIX}${view.siteId}/`)) {
        return NextResponse.json({ error: 'Image is not one of this site’s assets' }, { status: 400 });
      }
    }
    // The blocks become the page's LAYOUT — the same draft slot the editor writes.
    const written = await writeDraftLayout(admin, side, orgId, userId, pageLayoutFromBody(pageId, input.body), undefined, pageId);
    if (written.status === 'page_not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (written.status === 'pre180') return NextResponse.json({ error: 'Drafts and revisions need a database migration first (180)' }, { status: 409 });
    if (written.status === 'conflict') return NextResponse.json({ error: 'The draft changed while you were editing — reload and try again' }, { status: 409 });
    if (written.status !== 'ok') return NextResponse.json({ error: 'Failed to update the page' }, { status: 500 });
  }
  if (input.title !== undefined || input.visibility !== undefined) {
    const result = await applyDraftAction(admin, side, orgId, userId, { action: 'set_page', pageId, title: input.title, visibility: input.visibility }, CTX(side));
    if (result.status === 'conflict') return NextResponse.json({ error: 'The draft changed while you were editing — reload and try again' }, { status: 409 });
    if (result.status !== 'draft' && result.status !== 'live') return NextResponse.json({ error: 'Failed to update the page' }, { status: 500 });
  }
  const after = await loadPagesView(admin, side, orgId);
  const page = after?.pages.find(p => p.id === pageId);
  if (!after || !page) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ page: pageRowOf(after.siteId, page) });
}

export async function pageDELETE(admin: Admin, side: OrgSide, orgId: string, pageId: string, userId: string | null = null): Promise<NextResponse> {
  const view = await loadPagesView(admin, side, orgId);
  if (!view) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!view.pages.some(p => p.id === pageId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const result = await applyDraftAction(admin, side, orgId, userId, { action: 'remove_page', pageId }, CTX(side));
  if (result.status === 'conflict') return NextResponse.json({ error: 'The draft changed while you were editing — reload and try again' }, { status: 409 });
  if (result.status !== 'draft' && result.status !== 'live') return NextResponse.json({ error: 'Failed to delete the page' }, { status: 500 });
  return NextResponse.json({ success: true });
}

/** Page-image asset upload: no DB row (the storage sweep's orphan
 *  tolerance — an unreferenced asset is junk, not a leak: the whole
 *  org-media/{siteId}/ namespace is org-authored PUBLIC-site content
 *  by construction). Returns the bare path an image block stores. */
export async function siteAssetPOST(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  file: File,
  kind: 'image' | 'document' = 'image'
): Promise<NextResponse> {
  const site = await getSiteForOrg(admin, side, orgId);
  if (!site) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  }
  if (file.size > MAX_ASSET_BYTES) {
    return NextResponse.json(
      { error: `${kind === 'document' ? 'Document' : 'Image'} must be less than 10MB` },
      { status: 400 }
    );
  }
  // Phase 6b B3: PDFs (the documents module) ride the same prefix and
  // streamer; the org-media route passes content-type through and serves
  // inline, so a browser opens them like any hosted policy PDF.
  if (kind === 'document') {
    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Please select a PDF file' }, { status: 400 });
    }
    const pdfPath = `${ORG_MEDIA_PREFIX}${site.id}/${crypto.randomUUID()}.pdf`;
    const { error: pdfError } = await admin.storage
      .from('uploads')
      .upload(pdfPath, file, { cacheControl: '3600', upsert: false, contentType: 'application/pdf' });
    if (pdfError) {
      console.error(`${TAG} document upload error:`, pdfError);
      return NextResponse.json({ error: 'Failed to upload the document' }, { status: 500 });
    }
    return NextResponse.json({ path: pdfPath });
  }
  if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(file.type)) {
    return NextResponse.json(
      { error: 'Please select a valid image file (JPG, PNG, GIF, or WebP)' },
      { status: 400 }
    );
  }
  const ext =
    file.type === 'image/png'
      ? 'png'
      : file.type === 'image/webp'
        ? 'webp'
        : file.type === 'image/gif'
          ? 'gif'
          : 'jpg';
  const filePath = `${ORG_MEDIA_PREFIX}${site.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await admin.storage
    .from('uploads')
    .upload(filePath, file, { cacheControl: '3600', upsert: false });
  if (error) {
    console.error(`${TAG} asset upload error:`, error);
    return NextResponse.json({ error: 'Failed to upload the image' }, { status: 500 });
  }
  return NextResponse.json({ path: filePath });
}

/** B5: reclaim ONE asset this site uploaded and never saved (the editor's
 *  "Remove photo" on a fresh upload, or a discarded panel). The path must
 *  live under THIS site's prefix; a path some content still references is
 *  the caller's problem to know (the editor only deletes what it uploaded
 *  in the same unsaved session). Anything else is the storage sweep's. */
export async function siteAssetDELETE(admin: Admin, side: OrgSide, orgId: string, path: unknown): Promise<NextResponse> {
  const site = await getSiteForOrg(admin, side, orgId);
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  if (typeof path !== 'string' || !path.startsWith(`${ORG_MEDIA_PREFIX}${site.id}/`) || path.includes('..')) {
    return NextResponse.json({ error: 'Not one of this site’s assets' }, { status: 400 });
  }
  const { error } = await admin.storage.from('uploads').remove([path]);
  if (error) {
    console.error('[ORG SITE PAGES] asset delete error:', error);
    return NextResponse.json({ error: 'Failed to delete the asset' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
