// ── The console's team roster panel — the PURE half (teams & divisions, PR 5) ─
// What the panel shows from the roster GET: the candidates filtered by a
// typed name, split into the ones who can be added now (already on the org
// roster) and the ones who need the roster invite first. Node-tested.

export interface RosterCandidate {
  profileId: string;
  name: string;
  supervised: boolean;
  onRoster: boolean;
}

export function filterCandidates(candidates: readonly RosterCandidate[], query: string): { canAdd: RosterCandidate[]; needsInvite: RosterCandidate[] } {
  const q = query.trim().toLocaleLowerCase();
  const matched = candidates
    .filter(c => !q || c.name.toLocaleLowerCase().includes(q))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  return { canAdd: matched.filter(c => c.onRoster), needsInvite: matched.filter(c => !c.onRoster) };
}
