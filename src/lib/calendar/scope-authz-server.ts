// ── Who may put an event on a scope's calendar (teams & divisions PR 10) ────
// ONE rule for the event create and edit routes:
//   • an ORG-level event — the org's owner or managers (unchanged);
//   • a TEAM's or a DIVISION's event — also a staff grant that schedules or
//     runs that scope (authz.scheduleScopeAllows: a coach schedules their
//     team's practices; a division grant covers the teams entered in it).
// Never throws: a failed read answers false (the route refuses).

import type { SupabaseClient } from '@supabase/supabase-js';
import { getOrgCapabilities, isOwnerOrManager, scheduleScopeAllows } from '@/lib/orgs/authz';
import { divisionIdsForTeam } from '@/lib/orgs/scoped-members';
import type { EventScope } from './event-scope';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export async function canScheduleForScope(admin: Admin, scope: EventScope, profileId: string): Promise<boolean> {
  try {
    const caps = await getOrgCapabilities(admin, scope.side, scope.orgId, profileId);
    if (isOwnerOrManager(caps.role)) return true;
    if (scope.scopeType === 'org' || !scope.scopeId) return false;
    const parentDivisionIds = scope.scopeType === 'team' ? await divisionIdsForTeam(admin, scope.scopeId) : undefined;
    return scheduleScopeAllows(caps, { type: scope.scopeType, id: scope.scopeId, parentDivisionIds });
  } catch (e) {
    console.error('[CALENDAR SCOPE AUTHZ] failed:', e);
    return false;
  }
}

/** The refusal both routes answer. */
export const SCHEDULE_REFUSAL = "Only the organization's owner, managers or the staff who run this team or division can schedule its events";
