// ── Org LISTING state (Onboarding v2 R0, migration 179) ─────────────────────
// Tom (Sep 8 2026): "auto-approve unlisted, queue public". An org is LIVE
// BY LINK from the moment it exists — console, join door, member rounds,
// publishing. Admin approval decides only whether it is LISTED: the
// directories, the sitemap, the per-site robots.txt, search. This is the
// ONE reader those surfaces use (R1 rewires them from approval.ts).
//
//   unlisted  the owner chose "link only", or a listing was declined
//   pending   a listing request is in the admin queue (the public default)
//   listed    approved — discoverable and indexed
//
// Pre-179 (42703 / no column on the row) the state is DERIVED from
// approved_at — exactly today's semantics — so a deploy that precedes the
// migration changes nothing. A row with neither column (pre-174) is NOT
// KNOWN and reads as listed: nothing ever darkens. The pure half is
// node-tested.

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the notify.ts Admin alias; schema-agnostic
type Admin = SupabaseClient<any, 'public', any>;

export type OrgSide = 'league' | 'club';
export type ListingStatus = 'unlisted' | 'pending' | 'listed';

export const LISTING_STATUSES: readonly ListingStatus[] = ['unlisted', 'pending', 'listed'];

export interface ListingState {
  /** False when no listing column exists on the row (pre-174) or the org is missing. */
  known: boolean;
  status: ListingStatus;
  /** The listing approval timestamp (174's approved_at). */
  approvedAt: string | null;
  /** Clubs only (174); leagues carry sport_key elsewhere. */
  primarySport: string | null;
}

export const LISTING_NOT_KNOWN: ListingState = {
  known: false,
  status: 'listed',
  approvedAt: null,
  primarySport: null,
};

export function isListingStatus(value: unknown): value is ListingStatus {
  return typeof value === 'string' && (LISTING_STATUSES as readonly string[]).includes(value);
}

/** PURE: the state off an org row. listing_status wins when present;
 *  a pre-179 row derives from approved_at (NULL ⇒ pending, else listed);
 *  a row with neither is not known and reads as listed. */
export function listingFromRow(row: Record<string, unknown> | null | undefined): ListingState {
  if (!row) return LISTING_NOT_KNOWN;
  const approvedAt = typeof row.approved_at === 'string' ? row.approved_at : null;
  const primarySport = typeof row.primary_sport === 'string' && row.primary_sport ? row.primary_sport : null;
  if (isListingStatus(row.listing_status)) {
    return { known: true, status: row.listing_status, approvedAt, primarySport };
  }
  if ('approved_at' in row) {
    return { known: true, status: approvedAt === null ? 'pending' : 'listed', approvedAt, primarySport };
  }
  return { ...LISTING_NOT_KNOWN, primarySport };
}

/** PURE: may this org appear in the directories, the sitemap, search, and
 *  be indexed? Only a known-and-listed org; not-known (pre-174) stays
 *  listed so an old database never hides a live org. */
export function isListed(state: Pick<ListingState, 'status'>): boolean {
  return state.status === 'listed';
}

/** The live read. A 42703 on listing_status (pre-179) steps down to the
 *  approved_at read (pre-174 → not known). Any other error → not known. */
export async function readListing(admin: Admin, side: OrgSide, orgId: string): Promise<ListingState> {
  const table = side === 'league' ? 'leagues' : 'clubs';
  const sportCol = side === 'league' ? '' : ', primary_sport';
  const first = await admin
    .from(table)
    .select(`id, listing_status, approved_at${sportCol}`)
    .eq('id', orgId)
    .maybeSingle();
  if (!first.error) {
    return first.data ? listingFromRow(first.data as unknown as Record<string, unknown>) : LISTING_NOT_KNOWN;
  }
  if (first.error.code !== '42703') return LISTING_NOT_KNOWN;
  const second = await admin
    .from(table)
    .select(`id, approved_at${sportCol}`)
    .eq('id', orgId)
    .maybeSingle();
  if (second.error || !second.data) return LISTING_NOT_KNOWN;
  return listingFromRow(second.data as unknown as Record<string, unknown>);
}
