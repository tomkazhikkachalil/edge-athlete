// ── Team rosters — the PURE half (teams & divisions program, Sep 26 2026) ────
// A team roster spot is a memberships row (kind 'roster', scope 'team',
// scope_id = the team) and, since migration 242, it always names its SEASON.
// Node-tested; the server half is roster-server.ts (PR 4).

export interface SeasonCandidate {
  id: string;
  archived_at: string | null;
  created_at: string;
}

/** Which season a new team roster row belongs to — the rule 242's backfill
 *  used: the newest LIVE season the team is entered in (a division of it),
 *  else the org's newest live season. Null = the org has no live season
 *  (a team roster belongs to a season, so the caller refuses). */
export function pickRosterSeason(orgSeasons: readonly SeasonCandidate[], teamSeasonIds: ReadonlySet<string>): string | null {
  const live = orgSeasons.filter(s => !s.archived_at).sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  return (live.find(s => teamSeasonIds.has(s.id)) ?? live[0])?.id ?? null;
}

/** The statuses a team roster spot counts in (the writers insert 'active';
 *  'placed' is read too, the registration family's word). */
export const CURRENT_TEAM_STATUSES = ['active', 'placed'] as const;

/** A team roster row is CURRENT when its status counts and its season is
 *  still live — or it is a legacy season-less row (an org with no season
 *  when 242 ran). Last season's players keep their history row but stop
 *  counting: event sides, stat attribution, the calendar audience, the
 *  team page. */
export function isCurrentTeamRow(row: { status: string; season_id: string | null }, archivedSeasonIds: ReadonlySet<string>): boolean {
  if (!(CURRENT_TEAM_STATUSES as readonly string[]).includes(row.status)) return false;
  return row.season_id === null || !archivedSeasonIds.has(row.season_id);
}

export type TeamAddPlan = 'ok' | 'not_member' | 'needs_org_roster';

/** May a manager put this person on a team? They must be a MEMBER of the
 *  org (a follow row) and already on its ROSTER (an accepted org-roster
 *  edge — active or placed). The org roster is where consent lives: an adult
 *  opts in, a supervised athlete through the guardian's offer (convention
 *  10), so a team never carries a pending spot and never skips a guardian. */
export function planTeamAdd(input: { followRole: string | null; orgRosterStatuses: readonly string[] }): TeamAddPlan {
  if (!input.followRole) return 'not_member';
  return input.orgRosterStatuses.some(s => (CURRENT_TEAM_STATUSES as readonly string[]).includes(s)) ? 'ok' : 'needs_org_roster';
}

/** The refusal copy, one place (routes and the console read it). */
export const TEAM_ADD_REFUSAL: Record<Exclude<TeamAddPlan, 'ok'>, string> = {
  not_member: 'They need to join first — only members can be put on a team',
  needs_org_roster: 'Add them to your roster first — a team spot comes from the roster (a guardian approves a minor’s)',
};
