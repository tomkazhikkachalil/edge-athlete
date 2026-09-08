// ── The owner's listing switch (Onboarding v2 R1, 179) ──────────────────────
// "Ask to be listed" (→ pending: a request row in the admin queue + the
// admin bell) or "Link only" (→ unlisted: out of the directory, sitemap,
// search and the index; the org itself stays live). Exposed through the
// org PATCH beside visibility / joinPolicy — the same manage_org gate.
//
// The request row is the queue's unit (117/116): a listing request reopens
// the org's own row when one exists (status unlisted | declined → pending),
// else files a fresh one. One pending request per requester is the partial
// unique index's job — its 23505 is a 409 here, never a pre-check.

import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidateOrgSiteForOrg } from '@/lib/org-sites/revalidate';
import { notifyAdminsOfListingRequest } from './listing-notify';
import { nextListingChange, readListing, type ListingStatus, type OrgSide } from './listing';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the notify.ts Admin alias; schema-agnostic
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[ORG LISTING]';

export async function applyListing(
  admin: Admin,
  input: { side: OrgSide; orgId: string; orgName: string; actorId: string; target: Extract<ListingStatus, 'pending' | 'unlisted'> }
): Promise<NextResponse | { ok: true; status: ListingStatus }> {
  const { side, orgId, orgName, actorId, target } = input;
  const table = side === 'league' ? 'leagues' : 'clubs';
  const requestTable = side === 'league' ? 'league_requests' : 'club_requests';
  const orgCol = side === 'league' ? 'created_league_id' : 'created_club_id';

  const current = await readListing(admin, side, orgId);
  const change = nextListingChange({ current: current.status, target });
  if (change === 'noop') return { ok: true, status: current.status };

  // The request row first for → pending: the unique index decides.
  if (target === 'pending') {
    const { data: existing } = await admin
      .from(requestTable)
      .select('id, status')
      .eq(orgCol, orgId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = existing as { id: string; status: string } | null;
    let reqError: { code?: string; message?: string } | null = null;
    if (row && row.status !== 'approved') {
      ({ error: reqError } = await admin
        .from(requestTable)
        .update({ status: 'pending', decline_reason: null, decided_at: null, reviewed_by: null })
        .eq('id', row.id));
    } else if (!row) {
      ({ error: reqError } = await admin
        .from(requestTable)
        .insert({ name: orgName, requester_profile_id: actorId, status: 'pending', [orgCol]: orgId }));
    }
    if (reqError?.code === '23505') {
      return NextResponse.json({ error: 'You already have a listing request waiting for review' }, { status: 409 });
    }
    if (reqError) {
      console.error(`${TAG} request row error:`, reqError);
      return NextResponse.json({ error: 'Could not file the listing request' }, { status: 500 });
    }
  }

  const { error: orgError } = await admin.from(table).update({ listing_status: target }).eq('id', orgId);
  if (orgError?.code === 'PGRST204' && /listing_status/.test(orgError.message ?? '')) {
    return NextResponse.json({ error: 'Directory listing is not available yet' }, { status: 503 });
  }
  if (orgError) {
    console.error(`${TAG} org update error:`, orgError);
    return NextResponse.json({ error: 'Could not update the listing' }, { status: 500 });
  }

  if (target === 'unlisted') {
    // A queued request stops being a queue item; the row keeps its drafts.
    const { error } = await admin.from(requestTable).update({ status: 'unlisted' }).eq(orgCol, orgId).eq('status', 'pending');
    if (error && error.code !== '23514') console.error(`${TAG} request unlist error:`, error);
  } else {
    await notifyAdminsOfListingRequest(admin, { side, orgId, orgName, requesterId: actorId });
  }

  // The site's cached `listed` (robots meta, per-site robots.txt/sitemap)
  // and the directory + sitemap follow the flip.
  await revalidateOrgSiteForOrg(admin, side, orgId);
  revalidateTag('org-sitemap', { expire: 0 });
  return { ok: true, status: target };
}
