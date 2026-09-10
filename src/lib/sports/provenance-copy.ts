// ── The provenance ladder's words — pure, zero imports ────────────────────
// One vocabulary for the chips (SportSkillCards), the Official log and the
// explainer page (/help/verified-stats). Display the ACTUAL rung, never a
// generic "verified" — the ladder is the integrity story a scout
// interrogates (masterplan §7).

export type SkillProvenanceKey = 'sanctioned' | 'league_verified' | 'club_recorded' | 'tracked' | 'imported' | 'entered';

/** Strongest first — the order the explainer lists them. */
export const PROVENANCE_ORDER: readonly SkillProvenanceKey[] = [
  'sanctioned', 'league_verified', 'club_recorded', 'tracked', 'imported', 'entered',
];

export const PROVENANCE_LABEL: Record<SkillProvenanceKey, string> = {
  sanctioned: 'Sanctioned',
  league_verified: 'League verified',
  club_recorded: 'Club recorded',
  tracked: 'Tracked',
  imported: 'Imported',
  entered: 'Self-reported',
};

export const PROVENANCE_TITLE: Record<SkillProvenanceKey, string> = {
  sanctioned: 'Recorded in a sanctioned competition — the strongest verification tier',
  league_verified: 'Entered and verified by the competition owner',
  club_recorded: 'Recorded by team staff — not yet league-verified',
  tracked: 'Calculated from logged activity on Edge Athlete',
  imported: 'Imported historical record — labeled, not verified here',
  entered: 'Entered by the athlete — not verified',
};

/** The explainer's longer copy per rung. */
export const PROVENANCE_EXPLAINER: Record<SkillProvenanceKey, string> = {
  sanctioned:
    'The result was entered in a competition run by a league that sanctions the athlete’s club (directly or through its parent leagues). Nobody can self-assign this tier: it is derived from live sanctioning edges at read time.',
  league_verified:
    'The competition’s own staff entered or confirmed the result. A club cannot overwrite it downward.',
  club_recorded:
    'Team staff entered the line; the competition has not confirmed it yet.',
  tracked:
    'Calculated by Edge Athlete from activity the athlete logged (rounds, games) — arithmetic, not a claim.',
  imported:
    'Migrated from a historical record and labelled as such. Kept separate from anything verified here.',
  entered:
    'Typed in by the athlete. Shown, but never dressed up as verified.',
};

/** A line under an open dispute is UNCONFIRMED: it keeps its rung on the
 *  log (with the marker) and leaves the headline numbers until resolved. */
export const UNCONFIRMED_LABEL = 'Unconfirmed';
export const UNCONFIRMED_TITLE = 'Under dispute between the club and the league — left out of the headline numbers until resolved';
