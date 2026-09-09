import type { OrgSide } from './types';

// The per-side vocabulary of the org page — a LITERAL lookup table, so every
// string the two page twins carried survives the R1 fold byte-identical.
// (Both twins say "…rounds in <name> leagues" / "in club leagues" — the word
// is "leagues" on BOTH sides, so those two strings stay literal in OrgPage
// and useOrgPage; the fold does not touch copy, R2 may.)
export interface SideCopy {
  /** The API path segment and the word the old copy pluralised with. */
  plural: 'leagues' | 'clubs';
  /** Toast scope + headings ("League", "Club"). */
  label: 'League' | 'Club';
  /** Lower-case noun in running copy ("Join league", "Leave this club?"). */
  noun: OrgSide;
}

export const SIDE_COPY: Record<OrgSide, SideCopy> = {
  league: { plural: 'leagues', label: 'League', noun: 'league' },
  club: { plural: 'clubs', label: 'Club', noun: 'club' },
};
