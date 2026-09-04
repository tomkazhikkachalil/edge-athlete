// ── The org's staff (org staff program, 178) ────────────────────────────────
// Listing + revoke/change of grant rows. The list joins profiles for NAME
// and avatar only — never email, never guardian fields (charter 2). The
// ladder (owners / managers, follow rows) rides along so one call renders
// "who runs this org".

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from './authz';
import { normalizeSections } from './staff-validate';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;
const TAG = '[ORG STAFF]';

function orgColumn(side: OrgSide): 'league_id' | 'club_id' {
  return side === 'league' ? 'league_id' : 'club_id';
}

export interface StaffPerson {
  rowId: string;
  profileId: string;
  name: string;
  avatarUrl: string | null;
  /** owner | manager (ladder) | admin | staff (grant rows) */
  role: 'owner' | 'manager' | 'admin' | 'staff';
  sections: string[] | null;
  scopeType: 'org' | 'division' | 'team';
  scopeId: string | null;
  seasonId: string | null;
  grantedAt: string | null;
  expiresAt: string | null;
}

/** Everyone with authority in the org: ladder rows (owner/manager) and live
 *  staff rows. 42703-safe: a pre-178 database answers the ladder alone. */
export async function listStaff(admin: Admin, side: OrgSide, orgId: string): Promise<StaffPerson[]> {
  const col = orgColumn(side);
  let rows: Record<string, unknown>[] = [];
  const full = await admin
    .from('memberships')
    .select('id, profile_id, kind, role, sections, scope_type, scope_id, season_id, granted_at, expires_at')
    .eq(col, orgId)
    .in('kind', ['follow', 'staff'])
    .in('role', ['owner', 'manager', 'admin', 'staff'])
    .limit(500);
  if (full.error) {
    const ladder = await admin
      .from('memberships')
      .select('id, profile_id, kind, role, scope_type, scope_id, season_id')
      .eq(col, orgId)
      .eq('kind', 'follow')
      .in('role', ['owner', 'manager'])
      .limit(500);
    rows = (ladder.data ?? []) as Record<string, unknown>[];
  } else {
    rows = (full.data ?? []) as Record<string, unknown>[];
  }
  const now = Date.now();
  rows = rows.filter(r => {
    if (r.kind === 'follow') return r.scope_type === 'org';
    const exp = r.expires_at as string | null | undefined;
    return !exp || new Date(exp).getTime() > now;
  });
  const ids = [...new Set(rows.map(r => r.profile_id as string))];
  const { data: profiles } = ids.length
    ? await admin.from('profiles').select('id, first_name, last_name, full_name, display_name, avatar_url').in('id', ids)
    : { data: [] as Record<string, unknown>[] };
  const byId = new Map((profiles ?? []).map(p => [p.id as string, p as Record<string, unknown>]));
  const RANK = { owner: 0, manager: 1, admin: 2, staff: 3 } as const;
  return rows
    .map(r => {
      const p = byId.get(r.profile_id as string) ?? {};
      const name =
        [p.first_name, p.last_name].filter(Boolean).join(' ') ||
        (p.full_name as string | null) ||
        (p.display_name as string | null) ||
        'Member';
      return {
        rowId: r.id as string,
        profileId: r.profile_id as string,
        name,
        avatarUrl: (p.avatar_url as string | null) ?? null,
        role: r.role as StaffPerson['role'],
        sections: r.kind === 'staff' && r.role === 'staff' ? normalizeSections(r.sections as string[] | null) : null,
        scopeType: (r.scope_type as StaffPerson['scopeType']) ?? 'org',
        scopeId: (r.scope_id as string | null) ?? null,
        seasonId: (r.season_id as string | null) ?? null,
        grantedAt: (r.granted_at as string | null) ?? null,
        expiresAt: (r.expires_at as string | null) ?? null,
      };
    })
    .sort((a, b) => RANK[a.role] - RANK[b.role] || a.name.localeCompare(b.name));
}

/** A grant row of this org, by id — the change/revoke routes' lookup. */
export async function readStaffRow(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  rowId: string
): Promise<{ id: string; profileId: string; role: string; sections: string[] | null; scopeType: string; scopeId: string | null; seasonId: string | null } | null> {
  const { data } = await admin
    .from('memberships')
    .select('id, profile_id, role, sections, scope_type, scope_id, season_id')
    .eq('id', rowId)
    .eq(orgColumn(side), orgId)
    .eq('kind', 'staff')
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    profileId: data.profile_id as string,
    role: data.role as string,
    sections: (data.sections as string[] | null) ?? null,
    scopeType: data.scope_type as string,
    scopeId: (data.scope_id as string | null) ?? null,
    seasonId: (data.season_id as string | null) ?? null,
  };
}

export async function updateStaffSections(admin: Admin, rowId: string, sections: string[]): Promise<boolean> {
  const { error } = await admin
    .from('memberships')
    .update({ role: 'staff', sections: normalizeSections(sections) })
    .eq('id', rowId)
    .eq('kind', 'staff');
  if (error) console.error(`${TAG} sections update failed:`, error);
  return !error;
}

export async function deleteStaffRow(admin: Admin, rowId: string): Promise<boolean> {
  const { error } = await admin.from('memberships').delete().eq('id', rowId).eq('kind', 'staff');
  if (error) console.error(`${TAG} grant delete failed:`, error);
  return !error;
}
