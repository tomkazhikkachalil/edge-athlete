// ── Org site pages CRUD — the shared core (phase 3 R3) ─────────────────────
// org_site_pages is posture A (service-role only); both route twins wrap
// these. Slugs are minted from the title against RESERVED_PAGE_SLUGS
// (the module-key shadow rule) with -2..-20 collision suffixes — the
// mintSubdomain shape. Every write ends in revalidateTag: the public
// page, the nav, and the cached list all ride org-site:{subdomain}.
//
// Image blocks are re-asserted against THIS site's org-media/ prefix at
// PATCH time — the schema alone can't scope a path to the site, and a
// cross-site reference must never render.

import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from '@/lib/orgs/authz';
import { ALLOWED_IMAGE_MIME } from '@/lib/media/validation';
import {
  isValidPageSlug,
  PAGES_PER_SITE_MAX,
  slugifyPageTitle,
  type PageCreateInput,
  type PagePatchInput,
} from './validate';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[ORG SITE PAGES]';
const PAGE_FIELDS = 'id, site_id, slug, title, body, visibility, created_at, updated_at';
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

export async function pagesGET(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<NextResponse> {
  const site = await getSiteForOrg(admin, side, orgId);
  if (!site) return NextResponse.json({ pages: [] });
  const { data, error } = await admin
    .from('org_site_pages')
    .select(PAGE_FIELDS)
    .eq('site_id', site.id)
    .order('created_at', { ascending: true })
    .limit(PAGES_PER_SITE_MAX + 5);
  if (error) {
    console.error(`${TAG} list error:`, error);
    return NextResponse.json({ error: 'Failed to load pages' }, { status: 500 });
  }
  return NextResponse.json({ pages: data ?? [] });
}

export async function pageCreatePOST(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  input: PageCreateInput
): Promise<NextResponse> {
  const site = await getSiteForOrg(admin, side, orgId);
  if (!site) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  }
  const { count } = await admin
    .from('org_site_pages')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', site.id);
  if ((count ?? 0) >= PAGES_PER_SITE_MAX) {
    return NextResponse.json(
      { error: `A site can have at most ${PAGES_PER_SITE_MAX} pages` },
      { status: 400 }
    );
  }

  if (input.slug !== undefined) {
    // Explicit slug: reserved/invalid → 400; taken → 409. No retries.
    if (!isValidPageSlug(input.slug)) {
      return NextResponse.json(
        { error: 'That address is reserved or invalid' },
        { status: 400 }
      );
    }
    const { data: page, error } = await admin
      .from('org_site_pages')
      .insert({ site_id: site.id, slug: input.slug, title: input.title })
      .select(PAGE_FIELDS)
      .single();
    if (error || !page) {
      if (error?.code === '23505') {
        return NextResponse.json({ error: 'That address is already in use' }, { status: 409 });
      }
      console.error(`${TAG} create error:`, error);
      return NextResponse.json({ error: 'Failed to create the page' }, { status: 500 });
    }
    revalidateTag(`org-site:${site.subdomain}`, { expire: 0 });
    return NextResponse.json({ page });
  }

  // Minted slug: base from the title, then -2..-20 (the mintSubdomain shape).
  const base = slugifyPageTitle(input.title) || 'page';
  const candidates = [base, ...Array.from({ length: 19 }, (_, i) => `${base}-${i + 2}`)]
    .map(c => c.slice(0, 80))
    .filter(isValidPageSlug);
  for (const candidate of candidates) {
    const { data: page, error } = await admin
      .from('org_site_pages')
      .insert({ site_id: site.id, slug: candidate, title: input.title })
      .select(PAGE_FIELDS)
      .single();
    if (page) {
      revalidateTag(`org-site:${site.subdomain}`, { expire: 0 });
      return NextResponse.json({ page });
    }
    if (error?.code !== '23505') {
      console.error(`${TAG} create error:`, error);
      return NextResponse.json({ error: 'Failed to create the page' }, { status: 500 });
    }
  }
  return NextResponse.json(
    { error: 'Could not derive a free address from that title' },
    { status: 409 }
  );
}

export async function pageGET(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  pageId: string
): Promise<NextResponse> {
  const site = await getSiteForOrg(admin, side, orgId);
  if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { data: page } = await admin
    .from('org_site_pages')
    .select(PAGE_FIELDS)
    .eq('id', pageId)
    .eq('site_id', site.id)
    .maybeSingle();
  if (!page) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ page });
}

export async function pagePATCH(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  pageId: string,
  input: PagePatchInput
): Promise<NextResponse> {
  const site = await getSiteForOrg(admin, side, orgId);
  if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (input.body) {
    // The cross-site guard: every image path must live under THIS site's
    // asset prefix (the schema can't know the site id).
    for (const block of input.body) {
      if (block.type === 'image' && !block.path.startsWith(`${ORG_MEDIA_PREFIX}${site.id}/`)) {
        return NextResponse.json(
          { error: 'Image is not one of this site’s assets' },
          { status: 400 }
        );
      }
    }
  }

  const patch = {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
  };
  const { data: updated, error } = await admin
    .from('org_site_pages')
    .update(patch)
    .eq('id', pageId)
    .eq('site_id', site.id)
    .select(PAGE_FIELDS);
  if (error) {
    console.error(`${TAG} patch error:`, error);
    return NextResponse.json({ error: 'Failed to update the page' }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  revalidateTag(`org-site:${site.subdomain}`, { expire: 0 });
  return NextResponse.json({ page: updated[0] });
}

export async function pageDELETE(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  pageId: string
): Promise<NextResponse> {
  const site = await getSiteForOrg(admin, side, orgId);
  if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await admin
    .from('org_site_pages')
    .delete()
    .eq('id', pageId)
    .eq('site_id', site.id);
  if (error) {
    console.error(`${TAG} delete error:`, error);
    return NextResponse.json({ error: 'Failed to delete the page' }, { status: 500 });
  }
  revalidateTag(`org-site:${site.subdomain}`, { expire: 0 });
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
