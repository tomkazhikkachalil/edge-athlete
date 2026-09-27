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
