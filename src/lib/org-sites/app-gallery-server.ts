import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readOrgAccess } from '@/lib/orgs/access';
import { getOrgAndRole, type OrgSide } from '@/lib/orgs/authz';
import { fetchPublicGallery } from './public-data';
import { orderGalleryForApp } from './app-gallery';
import { readSiteBrandRow } from './revalidate';

// The in-app org gallery read (Org Pages R4, Sep 8 2026) — the Photos
// bubble on /league/[id] and /club/[id]. IDENTICAL gates to the public
// site: `fetchPublicGallery` (members' round photos through the
// member-photo gate — site published + org public + pick + public post +
// public unsupervised author + follow-row consent — and published contest
// media through the contest gate). Not relaxed for members on purpose: the
// streamers re-run the PUBLIC gate per request, so a relaxed list would
// enumerate items whose bytes 404. Labels stay masked as on the site (one
// label policy — Tom's call). Who may read: anyone for a public org
// (the content is anonymous-visible by construction, the activity
// precedent); members and the owner only for a private org (the site's
// members-only rule, in-app). Viewer-dependent → private, no-store. Each
// ROUTE calls getServerAuth itself (the route-authz audit).

type Admin = SupabaseClient;
const PRIVATE = { 'Cache-Control': 'private, no-store' };

function notFound(side: OrgSide) {
  return NextResponse.json({ error: side === 'league' ? 'League not found' : 'Club not found' }, { status: 404 });
}

export async function orgGalleryGET(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  viewerId: string | null
): Promise<NextResponse> {
  const access = await readOrgAccess(admin, side, orgId);
  if (!access.known) return notFound(side);
  let isMember = false;
  if (viewerId) {
    const loaded = await getOrgAndRole(admin, side, orgId, viewerId);
    if (loaded.status !== 'found') return notFound(side);
    isMember = !!loaded.role || loaded.org.owner_profile_id === viewerId;
  }
  if (access.visibility === 'private' && !isMember) {
    return NextResponse.json({ error: 'Members only' }, { status: 403 });
  }
  const [items, siteRow] = await Promise.all([
    fetchPublicGallery(admin, side, orgId),
    readSiteBrandRow(admin, side, orgId),
  ]);
  return NextResponse.json(
    {
      items: orderGalleryForApp(items),
      site: siteRow ? { id: siteRow.id, published: !!siteRow.published_at } : null,
    },
    { headers: PRIVATE }
  );
}
