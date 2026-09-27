// ── Team rosters — the SERVER half (teams & divisions program, PR 4) ─────────
// THE ONE WRITER of a team roster spot a manager places (add / move /
// remove), and THE ONE READER of who is on a team NOW. A spot is a
// memberships row: kind 'roster', scope_type 'team', scope_id = the team,
// season_id = its season (242's CHECK). "Now" = isCurrentTeamRow: an
// active / placed row whose season is live (or a legacy season-less row) —
// last season's players keep their history row but stop counting.
//
// Sanctioned twins that write the same rows: the CSV import
// (orgs/roster-import.ts — new stub athletes, the season from
// resolveTeamSeason) and registration placement (orgs/registration-
// server.ts — the registration's own season). Rollover's carry-forward
// (PR 11) writes through here.
//
// A team is always pinned to the org it is read or written under (a foreign
// or archived team is indistinguishable from missing).

import type { SupabaseClient } from '@supabase/supabase-js';
import { ORG_ID, pairFor, type OrgRef } from '@/lib/orgs/org-ref';
import { membershipEdges } from '@/lib/orgs/members';
import { CURRENT_TEAM_STATUSES, isCurrentTeamRow, pickRosterSeason, planTeamAdd, type SeasonCandidate, type TeamAddPlan } from './roster';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export interface TeamRosterRow {
  profile_id: string;
  scope_id: string;
  season_id: string | null;
  status: string;
  joined_at: string | null;
}

/** The archived subset of these season ids (one read; empty in → empty out). */
async function archivedAmong(admin: Admin, seasonIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(seasonIds)];
  if (ids.length === 0) return new Set();
  const { data } = await admin.from('seasons').select('id').in('id', ids).not('archived_at', 'is', null);
  return new Set(((data ?? []) as { id: string }[]).map(s => s.id));
}

/** The CURRENT roster rows of these teams. `orgId` pins them to one org when
 *  the caller holds it (every caller that can, does). Never throws: a failed
 *  read is an empty roster, logged. */
export async function currentTeamRosterRows(
  admin: Admin,
  teamIds: readonly string[],
  opts: { orgId?: string; profileIds?: readonly string[] } = {}
): Promise<TeamRosterRow[]> {
  if (teamIds.length === 0) return [];
  let query = admin
    .from('memberships')
    .select('profile_id, scope_id, season_id, status, joined_at')
    .eq('kind', 'roster')
    .eq('scope_type', 'team')
    .in('scope_id', [...teamIds])
    .in('status', [...CURRENT_TEAM_STATUSES]);
  if (opts.orgId) query = query.eq(ORG_ID, opts.orgId);
  if (opts.profileIds) query = query.in('profile_id', [...opts.profileIds]);
  const { data, error } = await query.limit(2000);
  if (error) {
    console.error('[TEAM ROSTER] read failed:', error);
    return [];
  }
  return keepCurrent(admin, (data ?? []) as TeamRosterRow[]);
}

/** For a reader that must keep its own select (an embed): drop the rows that
 *  are not CURRENT (status, or an archived season). One seasons read. */
export async function keepCurrent<T extends { status: string; season_id: string | null }>(admin: Admin, rows: readonly T[]): Promise<T[]> {
  const archived = await archivedAmong(admin, rows.map(r => r.season_id).filter((s): s is string => !!s));
  return rows.filter(r => isCurrentTeamRow(r, archived));
}

/** team id → the profiles on it now. */
export async function currentTeamRosterProfileIds(
  admin: Admin,
  teamIds: readonly string[],
  opts: { orgId?: string } = {}
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (const id of teamIds) out.set(id, new Set());
  for (const r of await currentTeamRosterRows(admin, teamIds, opts)) out.get(r.scope_id)?.add(r.profile_id);
  return out;
}

/** The teams these players are on NOW under one org (a meet's affiliation,
 *  a relay's common team) — rows newest first. */
export async function currentTeamRowsForProfiles(admin: Admin, orgId: string, profileIds: readonly string[]): Promise<TeamRosterRow[]> {
  if (profileIds.length === 0) return [];
  const { data, error } = await admin
    .from('memberships')
    .select('profile_id, scope_id, season_id, status, joined_at')
    .eq(ORG_ID, orgId)
    .eq('kind', 'roster')
    .eq('scope_type', 'team')
    .in('status', [...CURRENT_TEAM_STATUSES])
    .in('profile_id', [...profileIds])
    .not('scope_id', 'is', null)
    .order('joined_at', { ascending: false })
    .limit(2000);
  if (error) {
    console.error('[TEAM ROSTER] profile read failed:', error);
    return [];
  }
  return keepCurrent(admin, (data ?? []) as TeamRosterRow[]);
}

/** The season a new spot on this team belongs to — pickRosterSeason over the
 *  org's seasons and the team's entered ones. Null = no live season. */
export async function resolveTeamSeason(admin: Admin, orgId: string, teamId: string): Promise<string | null> {
  const [{ data: seasons }, { data: entries }] = await Promise.all([
    admin.from('seasons').select('id, archived_at, created_at').eq(ORG_ID, orgId),
    admin.from('team_entries').select('division:divisions(season_id)').eq('team_id', teamId),
  ]);
  const teamSeasonIds = new Set(
    ((entries ?? []) as { division: { season_id: string } | { season_id: string }[] | null }[])
      .flatMap(e => (Array.isArray(e.division) ? e.division : e.division ? [e.division] : []))
      .map(d => d.season_id)
  );
  return pickRosterSeason((seasons ?? []) as SeasonCandidate[], teamSeasonIds);
}

/** The team, pinned to the org and active — or null. */
export async function pinTeam(admin: Admin, orgId: string, teamId: string): Promise<{ id: string; name: string } | null> {
  const { data } = await admin.from('teams').select('id, name, status').eq('id', teamId).eq(ORG_ID, orgId).maybeSingle();
  const team = data as { id: string; name: string; status: string } | null;
  return team && team.status === 'active' ? { id: team.id, name: team.name } : null;
}

export type TeamRosterResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; reason: 'team_not_found' | 'no_season' | 'already_on_team' | 'not_on_team' | 'write_failed' | Exclude<TeamAddPlan, 'ok'> };

/** Add a member of the org's roster to a team, in the team's season. */
export async function addToTeam(
  admin: Admin,
  ref: OrgRef,
  teamId: string,
  profileId: string
): Promise<TeamRosterResult<{ team: { id: string; name: string }; seasonId: string }>> {
  const team = await pinTeam(admin, ref.orgId, teamId);
  if (!team) return { ok: false, reason: 'team_not_found' };
  const edges = await membershipEdges(admin, ref, profileId);
  if (edges.error) return { ok: false, reason: 'write_failed' };
  const plan = planTeamAdd({ followRole: edges.followRole, orgRosterStatuses: edges.rosterEdges.map(e => e.status) });
  if (plan !== 'ok') return { ok: false, reason: plan };
  const seasonId = await resolveTeamSeason(admin, ref.orgId, teamId);
  if (!seasonId) return { ok: false, reason: 'no_season' };
  const { error } = await admin.from('memberships').insert({
    ...pairFor(ref),
    profile_id: profileId,
    kind: 'roster',
    role: 'member',
    status: 'active',
    scope_type: 'team',
    scope_id: teamId,
    season_id: seasonId,
  });
  if (error) {
    if (error.code === '23505') return { ok: false, reason: 'already_on_team' };
    console.error('[TEAM ROSTER] add failed:', error);
    return { ok: false, reason: 'write_failed' };
  }
  return { ok: true, team, seasonId };
}

/** Move a player's CURRENT spot from one team to another (one UPDATE of the
 *  row's team; its season stays). */
export async function moveBetweenTeams(
  admin: Admin,
  ref: OrgRef,
  fromTeamId: string,
  toTeamId: string,
  profileId: string
): Promise<TeamRosterResult<{ from: { id: string; name: string }; to: { id: string; name: string } }>> {
  const [from, to] = await Promise.all([pinTeam(admin, ref.orgId, fromTeamId), pinTeam(admin, ref.orgId, toTeamId)]);
  if (!from || !to) return { ok: false, reason: 'team_not_found' };
  const [current] = await currentTeamRosterRows(admin, [fromTeamId], { orgId: ref.orgId, profileIds: [profileId] });
  if (!current) return { ok: false, reason: 'not_on_team' };
  let update = admin
    .from('memberships')
    .update({ scope_id: toTeamId })
    .eq(ORG_ID, ref.orgId)
    .eq('profile_id', profileId)
    .eq('kind', 'roster')
    .eq('scope_type', 'team')
    .eq('scope_id', fromTeamId);
  update = current.season_id === null ? update.is('season_id', null) : update.eq('season_id', current.season_id);
  const { error } = await update;
  if (error) {
    if (error.code === '23505') return { ok: false, reason: 'already_on_team' };
    console.error('[TEAM ROSTER] move failed:', error);
    return { ok: false, reason: 'write_failed' };
  }
  return { ok: true, from, to };
}

/** Take a player off a team: their CURRENT spot goes; a past season's row
 *  stays as history. */
export async function removeFromTeam(
  admin: Admin,
  ref: OrgRef,
  teamId: string,
  profileId: string
): Promise<TeamRosterResult<{ team: { id: string; name: string } }>> {
  const team = await pinTeam(admin, ref.orgId, teamId);
  if (!team) return { ok: false, reason: 'team_not_found' };
  const current = await currentTeamRosterRows(admin, [teamId], { orgId: ref.orgId, profileIds: [profileId] });
  if (current.length === 0) return { ok: false, reason: 'not_on_team' };
  const removed = await deleteRows(admin, ref, profileId, current);
  return removed ? { ok: true, team } : { ok: false, reason: 'write_failed' };
}

/** Leaving the org roster ends every CURRENT team spot the person holds in
 *  this org (roster-server rosterDelete). Returns the team ids ended. */
export async function endCurrentTeamSpots(admin: Admin, ref: OrgRef, profileId: string): Promise<string[]> {
  const { data } = await admin
    .from('memberships')
    .select('scope_id')
    .eq(ORG_ID, ref.orgId)
    .eq('profile_id', profileId)
    .eq('kind', 'roster')
    .eq('scope_type', 'team');
  const teamIds = [...new Set(((data ?? []) as { scope_id: string }[]).map(r => r.scope_id))];
  const current = await currentTeamRosterRows(admin, teamIds, { orgId: ref.orgId, profileIds: [profileId] });
  if (current.length === 0) return [];
  return (await deleteRows(admin, ref, profileId, current)) ? [...new Set(current.map(r => r.scope_id))] : [];
}

async function deleteRows(admin: Admin, ref: OrgRef, profileId: string, rows: readonly TeamRosterRow[]): Promise<boolean> {
  for (const row of rows) {
    let del = admin
      .from('memberships')
      .delete()
      .eq(ORG_ID, ref.orgId)
      .eq('profile_id', profileId)
      .eq('kind', 'roster')
      .eq('scope_type', 'team')
      .eq('scope_id', row.scope_id);
    del = row.season_id === null ? del.is('season_id', null) : del.eq('season_id', row.season_id);
    const { error } = await del;
    if (error) {
      console.error('[TEAM ROSTER] remove failed:', error);
      return false;
    }
  }
  return true;
}
