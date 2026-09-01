// ── Org site logo (phase 3 R3) — the cover-upload recipe, org-gated ────────
// Clones /api/upload/cover's mechanics exactly (10MB, shared image
// allowlist so no SVG, fixed `uploads` bucket, rollback on DB failure,
// best-effort old-file delete) with two differences: the caller is a
// verified org manager, and org_sites.logo_path stores the BARE storage
// path (a new column with no legacy URL format — the org-logo streamer
// signs it directly). Every write ends in revalidateTag so the public
// header updates immediately.

import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from '@/lib/orgs/authz';
import { ALLOWED_IMAGE_MIME } from '@/lib/media/validation';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[ORG SITE LOGO]';
const MAX_LOGO_BYTES = 10 * 1024 * 1024;
export const ORG_LOGO_PREFIX = 'org-logos/';

function orgColumn(side: OrgSide): 'league_id' | 'club_id' {
  return side === 'league' ? 'league_id' : 'club_id';
}

async function getSite(admin: Admin, side: OrgSide, orgId: string) {
  const { data } = await admin
    .from('org_sites')
    .select('id, subdomain, logo_path')
    .eq(orgColumn(side), orgId)
    .maybeSingle();
  return data as { id: string; subdomain: string; logo_path: string | null } | null;
}

/** Best-effort removal — only paths this feature manages. */
async function removeManagedFile(admin: Admin, path: string | null) {
  if (!path || !path.startsWith(ORG_LOGO_PREFIX)) return;
  const { error } = await admin.storage.from('uploads').remove([path]);
  if (error) console.warn(`${TAG} previous logo cleanup failed:`, error);
}

export async function siteLogoPOST(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  file: File
): Promise<NextResponse> {
  const site = await getSite(admin, side, orgId);
  if (!site) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  }
  if (file.size > MAX_LOGO_BYTES) {
    return NextResponse.json({ error: 'Logo must be less than 10MB' }, { status: 400 });
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
  const filePath = `${ORG_LOGO_PREFIX}${site.id}/${Date.now()}.${ext}`;

  const { error: uploadError } = await admin.storage
    .from('uploads')
    .upload(filePath, file, { cacheControl: '3600', upsert: false });
  if (uploadError) {
    console.error(`${TAG} upload error:`, uploadError);
    return NextResponse.json({ error: 'Failed to upload the logo' }, { status: 500 });
  }

  const { error: updateError } = await admin
    .from('org_sites')
    .update({ logo_path: filePath })
    .eq('id', site.id);
  if (updateError) {
    // Roll the orphan back — the site still points at the old logo.
    await admin.storage.from('uploads').remove([filePath]);
    console.error(`${TAG} db update error:`, updateError);
    return NextResponse.json({ error: 'Failed to save the logo' }, { status: 500 });
  }

  await removeManagedFile(admin, site.logo_path);
  revalidateTag(`org-site:${site.subdomain}`, { expire: 0 });
  return NextResponse.json({ success: true, logo_path: filePath });
}

export async function siteLogoDELETE(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<NextResponse> {
  const site = await getSite(admin, side, orgId);
  if (!site) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  }
  const { error } = await admin
    .from('org_sites')
    .update({ logo_path: null })
    .eq('id', site.id);
  if (error) {
    console.error(`${TAG} db clear error:`, error);
    return NextResponse.json({ error: 'Failed to remove the logo' }, { status: 500 });
  }
  await removeManagedFile(admin, site.logo_path);
  revalidateTag(`org-site:${site.subdomain}`, { expire: 0 });
  return NextResponse.json({ success: true });
}
