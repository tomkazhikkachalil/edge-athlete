// ── Club access (phase 9 V1) — visibility + join policy ────────────────────
// Tom: clubs are "private or public"; joining "needs an approval process".
// This is the ONE reader every gate uses (the club GET, the org-site
// modules, the standings twins, search, the join route), so a pre-176
// database (42703) reads "public / open" and never darkens anything.
// The pure halves are node-tested. CLUBS ONLY for now.

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the notify.ts Admin alias; schema-agnostic
type Admin = SupabaseClient<any, 'public', any>;

export type ClubVisibility = 'public' | 'private';
export type ClubJoinPolicy = 'open' | 'approval';

export interface ClubAccess {
  /** False when the columns are unknown (pre-176) or the club is missing. */
  known: boolean;
  visibility: ClubVisibility;
  joinPolicy: ClubJoinPolicy;
}

export const OPEN_ACCESS: ClubAccess = { known: false, visibility: 'public', joinPolicy: 'open' };

/** PURE: the access off a club row (absent columns ⇒ public / open). */
export function accessFromRow(row: Record<string, unknown> | null | undefined): ClubAccess {
  if (!row || !('visibility' in row)) return OPEN_ACCESS;
  return {
    known: true,
    visibility: row.visibility === 'private' ? 'private' : 'public',
    joinPolicy: row.join_policy === 'approval' ? 'approval' : 'open',
  };
}

/** The live read. Any error (42703 on a pre-176 database included) → open. */
export async function readClubAccess(admin: Admin, clubId: string): Promise<ClubAccess> {
  const { data, error } = await admin.from('clubs').select('id, visibility, join_policy').eq('id', clubId).maybeSingle();
  if (error || !data) return OPEN_ACCESS;
  return accessFromRow(data as unknown as Record<string, unknown>);
}

/** PURE: may this viewer see the members-only content (standings, results,
 *  players, roster)? A public club shows everyone; a private one shows
 *  members (any role) only. */
export function canSeeMembersContent(input: { visibility: ClubVisibility; isMember: boolean }): boolean {
  return input.visibility === 'public' || input.isMember;
}

export function isPrivate(access: Pick<ClubAccess, 'visibility'>): boolean {
  return access.visibility === 'private';
}
