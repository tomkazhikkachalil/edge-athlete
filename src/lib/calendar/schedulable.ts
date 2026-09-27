// ── Where may this person put an event? — the PURE half (teams & divisions leftovers 2) ─
// The calendar's event form offers exactly what the event routes will
// accept (calendar/scope-authz-server.ts): the WHOLE org for its owners and
// managers; each division and team the person may schedule
// (authz.scheduleScopeAllows — the scheduling grant, or the grant that runs
// that scope; a division grant covers its teams). An org with nothing to
// offer is not listed. Node-tested.

import { isOwnerOrManager, scheduleScopeAllows, type OrgCapabilities } from '@/lib/orgs/authz';

export interface OrgStructureForScheduling {
  divisions: { id: string; name: string }[];
  teams: { id: string; name: string; divisionIds: string[] }[];
}

export interface SchedulableScopes {
  wholeOrg: boolean;
  divisions: { id: string; name: string }[];
  teams: { id: string; name: string }[];
}

export function schedulableScopes(caps: OrgCapabilities, structure: OrgStructureForScheduling): SchedulableScopes | null {
  const wholeOrg = isOwnerOrManager(caps.role);
  const divisions = structure.divisions.filter(d => scheduleScopeAllows(caps, { type: 'division', id: d.id }));
  const teams = structure.teams
    .filter(t => scheduleScopeAllows(caps, { type: 'team', id: t.id, parentDivisionIds: t.divisionIds }))
    .map(t => ({ id: t.id, name: t.name }));
  if (!wholeOrg && divisions.length === 0 && teams.length === 0) return null;
  return { wholeOrg, divisions, teams };
}
