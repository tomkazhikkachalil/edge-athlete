// ── Schedulable structure options (0.9) — the event form's sub-org picker ───
// The twin /structure-options routes wrap this. Owner/manager-gated
// (roleAllows 'schedule_events' — the same authority that may attach the
// event); the payload is deliberately tiny: active teams + divisions with
// their season label for disambiguation. Orgs without structure return
// empty lists and the picker hides itself — the "naturally empty" v1
// surface (Tom, Aug 31): no flag, phase 1's org-manager CRUD is what
// populates it for real orgs.

import { NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getOrgAndRole, roleAllows, type OrgSide } from './authz';
import { isMissingTableError } from '@/lib/leagues/validate';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export interface StructureOption {
  id: string;
  name: string;
}

export async function structureOptionsGET(
  admin: Admin,
  user: User,
  side: OrgSide,
  orgId: string
): Promise<NextResponse> {
  const loaded = await getOrgAndRole(admin, side, orgId, user.id);
  if (loaded.status === 'error') {
    console.error('[STRUCTURE OPTIONS] org fetch error:', loaded.error);
    return NextResponse.json({ error: 'Failed to load organization' }, { status: 500 });
  }
  if (loaded.status === 'not_found') {
    return NextResponse.json(
      { error: side === 'league' ? 'League not found' : 'Club not found' },
      { status: 404 }
    );
  }
  if (!roleAllows(loaded.role, 'schedule_events')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const orgColumn = side === 'league' ? 'league_id' : 'club_id';
  const [divisionsRes, teamsRes] = await Promise.all([
    admin
      .from('divisions')
      .select('id, name, season:season_id (label)')
      .eq(orgColumn, orgId)
      .order('name'),
    admin.from('teams').select('id, name').eq(orgColumn, orgId).eq('status', 'active').order('name'),
  ]);
  for (const { error } of [divisionsRes, teamsRes]) {
    // Pre-145 database: no structure, an empty picker — never an error.
    if (error && !isMissingTableError(error.code)) {
      console.error('[STRUCTURE OPTIONS] read error:', error);
      return NextResponse.json({ error: 'Failed to load structure' }, { status: 500 });
    }
  }

  const divisions: StructureOption[] = (divisionsRes.data ?? []).map(d => {
    const season = d.season as { label?: string } | { label?: string }[] | null;
    const label = Array.isArray(season) ? season[0]?.label : season?.label;
    return { id: d.id as string, name: label ? `${d.name} · ${label}` : (d.name as string) };
  });
  const teams: StructureOption[] = (teamsRes.data ?? []).map(t => ({
    id: t.id as string,
    name: t.name as string,
  }));
  return NextResponse.json({ divisions, teams });
}
