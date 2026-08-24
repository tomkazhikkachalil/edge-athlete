// ── Affiliation authorization (118) — the one genuinely shared helper ───────
// Both org kinds answer "what is this profile to this org?" identically, and
// all four affiliation handler groups need it — cheap-share territory, not
// premature generalization (the org CREATION helpers stay parallel on
// purpose; see clubs/create.ts).

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the notify.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export type OrgRole = 'owner' | 'manager' | 'member';
export type OrgMemberTable = 'league_members' | 'club_members';

/** The profile's role in an org, from its members table + the org row's
 *  owner column (owners hold power even without a member row). */
export async function getOrgRole(
  admin: Admin,
  table: OrgMemberTable,
  orgId: string,
  profileId: string,
  ownerProfileId: string | null
): Promise<OrgRole | null> {
  if (ownerProfileId && ownerProfileId === profileId) return 'owner';
  const idColumn = table === 'league_members' ? 'league_id' : 'club_id';
  const { data } = await admin
    .from(table)
    .select('role')
    .eq(idColumn, orgId)
    .eq('profile_id', profileId)
    .maybeSingle();
  return (data?.role as OrgRole | undefined) ?? null;
}

export function isOwnerOrManager(role: OrgRole | null): boolean {
  return role === 'owner' || role === 'manager';
}
