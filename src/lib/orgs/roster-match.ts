/**
 * Roster name matching — pure, node-tested (phase 6c I2). The stat-line
 * CSV importer names players by TEXT; the attribution gate needs a
 * profile id on the team's ACTIVE roster. Matching is exact after
 * normalization (NFD, diacritics stripped, lowercased, whitespace
 * collapsed) and must be UNIQUE — an ambiguous name is a row error, never
 * a guess (a wrong athlete on a stat line is a provenance lie).
 */

export interface RosterName {
  profileId: string;
  displayName: string;
}

export function normalizeName(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9' -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type RosterMatch =
  | { ok: true; profileId: string; displayName: string }
  | { ok: false; error: 'not found' | 'ambiguous'; candidates?: string[] };

/** Match a typed name against a team's roster (exact normalized name; a
 *  "Last, First" input is flipped). */
export function matchRosterName(name: string, roster: RosterName[]): RosterMatch {
  let wanted = normalizeName(name);
  if (!wanted) return { ok: false, error: 'not found' };
  if (name.includes(',')) {
    const [last, first] = name.split(',').map(s => s.trim());
    if (first && last) wanted = normalizeName(`${first} ${last}`);
  }
  const hits = roster.filter(r => normalizeName(r.displayName) === wanted);
  if (hits.length === 1) return { ok: true, profileId: hits[0].profileId, displayName: hits[0].displayName };
  if (hits.length > 1) return { ok: false, error: 'ambiguous', candidates: hits.map(h => h.displayName) };
  return { ok: false, error: 'not found' };
}
