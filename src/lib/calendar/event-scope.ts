// ── Event scope resolution (0.9) ────────────────────────────────────────────
// An event carries at most ONE of org_id/division_id/team_id
// (events_one_scope_check, 146 — org_id since Round 5 D0-b; the public
// league_id/club_id fields are derived at the route boundary). Every
// consumer resolves through HERE: a division/team event's owning org comes
// off the structure row (divisions/teams carry org_id — the one-read property
// 145 bought for 0.9), its KIND through the organizations embed.
//
// A dangling scope (division/team row deleted → events FK is SET NULL, but
// mid-flight reads can race) resolves to null — callers treat that exactly
// like an unscoped event.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from '@/lib/orgs/authz';
import { type OrgKindRow, type OrgRef, isOrgKind, orgRefOf, publicOrgRow } from '@/lib/orgs/org-ref';
import type { SubOrgScopeType } from '@/lib/orgs/scoped-members';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export interface ScopeColumns extends OrgKindRow {
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

/** The ref a row or a normalised body names. A row selected with the embed
 *  answers from it; a body carries `org_id` alone (the boundary parsed the
 *  public league_id / club_id into it), so the kind is ONE read of
 *  organizations — never skipped: the route's manager check on a new
 *  org-scoped event depends on this resolving. */
export async function orgRefWithKind(admin: Admin, row: OrgKindRow): Promise<OrgRef | null> {
  const own = orgRefOf(row);
  if (own) return own;
  if (!row.org_id) return null;
  const { data } = await admin.from('organizations').select('kind').eq('id', row.org_id).maybeSingle();
  const kind = (data as { kind?: unknown } | null)?.kind;
  return isOrgKind(kind) ? { side: kind, orgId: row.org_id } : null;
}

/** A stored event row as the CLIENT reads it: the embed stripped, the public
 *  league_id / club_id derived from org_id + kind (Tom, Sep 22 2026: the
 *  contract does not change). */
export const publicEventRow = publicOrgRow;

export function hasEventScope(event: ScopeColumns): boolean {
  return !!(event.org_id || event.division_id || event.team_id);
}

/** Resolve an event's scope to its owning org. Null when the event is
 *  unscoped OR its structure row is gone (degrade, never throw). */
export async function resolveEventScope(
  admin: Admin,
  event: ScopeColumns
): Promise<EventScope | null> {
  const own = await orgRefWithKind(admin, event);
  if (own) return { scopeType: 'org', side: own.side, orgId: own.orgId, scopeId: null };
  const sub: { table: 'divisions' | 'teams'; scopeType: SubOrgScopeType; id: string } | null =
    event.division_id
      ? { table: 'divisions', scopeType: 'division', id: event.division_id }
      : event.team_id
        ? { table: 'teams', scopeType: 'team', id: event.team_id }
        : null;
  if (!sub) return null;

  const { data, error } = await admin
    .from(sub.table)
    .select('id, org_id, org:organizations(kind)')
    .eq('id', sub.id)
    .maybeSingle();
  if (error || !data) return null;
  const owner = orgRefOf(data as OrgKindRow);
  if (!owner) return null;
  const side: OrgSide = owner.side;
  return { scopeType: sub.scopeType, side, orgId: owner.orgId, scopeId: sub.id };
}
