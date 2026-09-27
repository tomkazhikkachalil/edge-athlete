// The Teams dropdown's contents (sports-team website program, L1, Sep 27
// 2026). A multi-team club's header lists its teams grouped by division —
// the way a visitor thinks ("U13 → the Comets") — capped so a 60-team
// association never draws a wall; "All teams" covers the rest. Pure, zero
// imports; the team order is the reader's (fetchPublicTeams).

export interface NavTeamInput {
  id: string;
  name: string;
  /** "U13 A · 2026 Winter" — the first one is the team's division label. */
  divisionLabels: readonly string[];
  /** L2: the crest the dropdown draws beside the name (optional). */
  logoUrl?: string | null;
  color?: string | null;
  ink?: string | null;
}

export interface NavTeam {
  id: string;
  name: string;
  logoUrl?: string | null;
  color?: string | null;
  ink?: string | null;
}

export interface NavTeamGroup {
  /** null = teams without a division (one plain list when nobody has one). */
  label: string | null;
  teams: NavTeam[];
}

export const NAV_TEAMS_CAP = 24;

export function groupTeamsForNav(
  teams: readonly NavTeamInput[],
  cap: number = NAV_TEAMS_CAP
): { groups: NavTeamGroup[]; truncated: boolean } {
  const shown = teams.slice(0, Math.max(0, cap));
  const groups: NavTeamGroup[] = [];
  const byLabel = new Map<string | null, NavTeamGroup>();
  for (const t of shown) {
    const label = t.divisionLabels[0]?.trim() || null;
    let group = byLabel.get(label);
    if (!group) {
      group = { label, teams: [] };
      byLabel.set(label, group);
      groups.push(group);
    }
    group.teams.push({
      id: t.id,
      name: t.name,
      ...(t.logoUrl ? { logoUrl: t.logoUrl } : {}),
      ...(t.color ? { color: t.color } : {}),
      ...(t.ink ? { ink: t.ink } : {}),
    });
  }
  // Teams without a division read last, under their own heading, unless
  // they are the only group (then the heading is dropped).
  const loose = byLabel.get(null);
  const ordered = loose && groups.length > 1 ? [...groups.filter(g => g !== loose), loose] : groups;
  return { groups: ordered, truncated: teams.length > shown.length };
}
