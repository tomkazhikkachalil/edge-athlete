// ── The org hierarchy tree (org staff program, round 5) ─────────────────────
// Pure: seasons → divisions → entered teams, unentered teams under an
// "unassigned" node, and the people who hold authority at each node (the
// ladder + org-wide grants on the org node; scoped grants on their
// division / team). Rendered by HierarchySection; node-tested here.

export interface HierarchyPerson {
  rowId: string;
  profileId: string;
  name: string;
  avatarUrl: string | null;
  role: 'owner' | 'manager' | 'admin' | 'staff';
  sections: string[] | null;
  scopeType: 'org' | 'division' | 'team';
  scopeId: string | null;
  seasonId: string | null;
}

export interface HierarchyTeam {
  id: string;
  name: string;
  people: HierarchyPerson[];
}

export interface HierarchyDivision {
  id: string;
  name: string;
  teams: HierarchyTeam[];
  people: HierarchyPerson[];
}

export interface HierarchySeason {
  id: string;
  label: string;
  archived: boolean;
  divisions: HierarchyDivision[];
}

export interface HierarchyTree {
  orgPeople: HierarchyPerson[];
  seasons: HierarchySeason[];
  unassignedTeams: HierarchyTeam[];
}

export interface HierarchySeasonInput {
  id: string;
  label: string;
  archived?: boolean;
  divisions: Array<{ id: string; name: string; entries: Array<{ team_id: string }> }>;
}

export interface HierarchyTeamInput {
  id: string;
  name: string;
  display_name?: string | null;
  status?: string;
}

/** Build the tree. Archived seasons are kept (collapsed by the renderer)
 *  so a season-pinned grant still has a home; teams entered anywhere are
 *  not "unassigned"; archived teams are omitted. */
export function buildHierarchy(
  seasons: readonly HierarchySeasonInput[],
  teams: readonly HierarchyTeamInput[],
  people: readonly HierarchyPerson[]
): HierarchyTree {
  const teamName = new Map(teams.map(t => [t.id, t.display_name || t.name]));
  const byScope = (type: 'division' | 'team', id: string) =>
    people.filter(p => p.scopeType === type && p.scopeId === id);
  const entered = new Set<string>();
  const built: HierarchySeason[] = seasons.map(s => ({
    id: s.id,
    label: s.label,
    archived: s.archived === true,
    divisions: s.divisions.map(d => ({
      id: d.id,
      name: d.name,
      people: byScope('division', d.id),
      teams: [...new Set(d.entries.map(e => e.team_id))]
        .filter(id => teamName.has(id))
        .map(id => {
          entered.add(id);
          return { id, name: teamName.get(id)!, people: byScope('team', id) };
        }),
    })),
  }));
  const unassignedTeams: HierarchyTeam[] = teams
    .filter(t => !entered.has(t.id) && t.status !== 'archived')
    .map(t => ({ id: t.id, name: t.display_name || t.name, people: byScope('team', t.id) }));
  const RANK = { owner: 0, manager: 1, admin: 2, staff: 3 } as const;
  const orgPeople = people
    .filter(p => p.scopeType === 'org')
    .sort((a, b) => RANK[a.role] - RANK[b.role] || a.name.localeCompare(b.name));
  return { orgPeople, seasons: built, unassignedTeams };
}

/** Which season the tree opens on: the newest non-archived, else the newest. */
export function defaultOpenSeasonId(seasons: readonly HierarchySeason[]): string | null {
  const live = seasons.filter(s => !s.archived);
  return (live[0] ?? seasons[0])?.id ?? null;
}
