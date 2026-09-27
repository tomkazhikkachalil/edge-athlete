// ── Where may this person put an event? — the READS (teams & divisions leftovers 2) ─
// Every org the person belongs to or holds a staff grant in (bounded), its
// capabilities (getOrgCapabilities — the moderation ceiling included), its
// live structure (divisions of live seasons, active teams and their
// entries), folded through the pure `schedulableScopes`. The calendar's
// event form reads this one answer; the event routes re-decide on write.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ORG_ID, type OrgKind } from '@/lib/orgs/org-ref';
import { getOrgCapabilities, hasAnyCapability } from '@/lib/orgs/authz';
import { schedulableScopes, type SchedulableScopes } from './schedulable';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export interface SchedulableOrg extends SchedulableScopes {
  kind: OrgKind;
  id: string;
  name: string;
}

const MAX_ORGS = 50;

export async function listSchedulableOrgs(admin: Admin, profileId: string): Promise<SchedulableOrg[]> {
  const { data: rows, error } = await admin.from('memberships').select('org_id').eq('profile_id', profileId).in('kind', ['follow', 'staff']).limit(500);
  if (error) {
    console.error('[SCHEDULABLE] memberships read failed:', error);
    return [];
  }
  const orgIds = [...new Set(((rows ?? []) as { org_id: string | null }[]).map(r => r.org_id).filter((v): v is string => !!v))].slice(0, MAX_ORGS);
  if (orgIds.length === 0) return [];
  const { data: orgs } = await admin.from('organizations').select('id, name, kind').in('id', orgIds);
  const out: SchedulableOrg[] = [];
  await Promise.all(
    ((orgs ?? []) as { id: string; name: string; kind: string }[]).map(async org => {
      const kind = org.kind === 'league' || org.kind === 'club' ? (org.kind as OrgKind) : null;
      if (!kind) return;
      const caps = await getOrgCapabilities(admin, kind, org.id, profileId);
      if (!hasAnyCapability(caps)) return;
      const [divisionsRes, teamsRes] = await Promise.all([
        admin.from('divisions').select('id, name, season:seasons(label, archived_at)').eq(ORG_ID, org.id).order('name').limit(200),
        admin.from('teams').select('id, name, display_name').eq(ORG_ID, org.id).eq('status', 'active').order('name').limit(200),
      ]);
      type DivisionRow = { id: string; name: string; season: { label: string; archived_at: string | null } | { label: string; archived_at: string | null }[] | null };
      const divisions = ((divisionsRes.data ?? []) as unknown as DivisionRow[])
        .map(d => ({ ...d, season: Array.isArray(d.season) ? d.season[0] : d.season }))
        .filter(d => !d.season?.archived_at)
        .map(d => ({ id: d.id, name: d.season?.label ? `${d.name} · ${d.season.label}` : d.name }));
      const teams = (teamsRes.data ?? []) as { id: string; name: string; display_name: string | null }[];
      const { data: entries } = teams.length ? await admin.from('team_entries').select('team_id, division_id').in('team_id', teams.map(t => t.id)) : { data: [] };
      const divisionsOf = new Map<string, string[]>();
      for (const e of (entries ?? []) as { team_id: string; division_id: string }[]) divisionsOf.set(e.team_id, [...(divisionsOf.get(e.team_id) ?? []), e.division_id]);
      const scopes = schedulableScopes(caps, {
        divisions,
        teams: teams.map(t => ({ id: t.id, name: t.display_name || t.name, divisionIds: divisionsOf.get(t.id) ?? [] })),
      });
      if (scopes) out.push({ kind, id: org.id, name: org.name, ...scopes });
    })
  );
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
