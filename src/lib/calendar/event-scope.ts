// ── Event scope resolution (0.9) ────────────────────────────────────────────
// An event carries at most ONE of league_id/club_id/division_id/team_id
// (events_one_scope_check, 146). Every consumer that used to coalesce
// `league_id ?? club_id` resolves through HERE instead: a division/team
// event's owning org comes off the structure row (divisions/teams carry
// the org pair denormalized — the one-read property 145 bought for 0.9).
//
// A dangling scope (division/team row deleted → events FK is SET NULL, but
// mid-flight reads can race) resolves to null — callers treat that exactly
// like an unscoped event.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from '@/lib/orgs/authz';
import type { SubOrgScopeType } from '@/lib/orgs/scoped-members';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export interface ScopeColumns {
  league_id?: string | null;
  club_id?: string | null;
  division_id?: string | null;
  team_id?: string | null;
}

export interface EventScope {
  /** 'org' = attached directly to a league/club (the 119 shape). */
  scopeType: 'org' | SubOrgScopeType;
  side: OrgSide;
  orgId: string;
  /** The division/team id for sub-org scopes; null at org scope. */
  scopeId: string | null;
}

export function hasEventScope(event: ScopeColumns): boolean {
  return !!(event.league_id || event.club_id || event.division_id || event.team_id);
}

/** Resolve an event's scope to its owning org. Null when the event is
 *  unscoped OR its structure row is gone (degrade, never throw). */
export async function resolveEventScope(
  admin: Admin,
  event: ScopeColumns
): Promise<EventScope | null> {
  if (event.league_id) {
    return { scopeType: 'org', side: 'league', orgId: event.league_id, scopeId: null };
  }
  if (event.club_id) {
    return { scopeType: 'org', side: 'club', orgId: event.club_id, scopeId: null };
  }
  const sub: { table: 'divisions' | 'teams'; scopeType: SubOrgScopeType; id: string } | null =
    event.division_id
      ? { table: 'divisions', scopeType: 'division', id: event.division_id }
      : event.team_id
        ? { table: 'teams', scopeType: 'team', id: event.team_id }
        : null;
  if (!sub) return null;

  const { data, error } = await admin
    .from(sub.table)
    .select('id, league_id, club_id')
    .eq('id', sub.id)
    .maybeSingle();
  if (error || !data) return null;
  const side: OrgSide | null = data.league_id ? 'league' : data.club_id ? 'club' : null;
  if (!side) return null;
  return {
    scopeType: sub.scopeType,
    side,
    orgId: (data.league_id ?? data.club_id) as string,
    scopeId: sub.id,
  };
}
