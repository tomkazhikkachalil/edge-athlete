/**
 * Entries (Competition formats, track 2, PR 6 — 219) — pure. ONE naming
 * rule for an entry: the team's name → the athlete's (masked by the
 * caller) → the ad-hoc entry's own `name`. An ad-hoc entry is neither a
 * team nor an athlete: both ids null, a name, members. It is "a team" for
 * the entrant column and the people rules (`isTeamEntry`), and the shape
 * an org's default team shadows later (promote = SET team_id; the name
 * stays the snapshot label, the members "who played").
 */
export interface EntryLike {
  team_id: string | null;
  profile_id: string | null;
  name?: string | null;
}

export const isAdHocEntry = (e: EntryLike): boolean => !e.team_id && !e.profile_id && !!e.name;
export const isTeamEntry = (e: EntryLike): boolean => !!e.team_id || !!e.name;

/** team name → athlete name → the ad-hoc name → a kind word. */
export function entryDisplayName(e: EntryLike, teamName: string | null | undefined, profileName: string | null | undefined): string {
  if (e.team_id) return teamName ?? 'Team';
  if (e.profile_id) return profileName ?? 'Athlete';
  return e.name?.trim() || 'Entrant';
}

export const AD_HOC_NAME_MAX = 80;
export const AD_HOC_MEMBERS_MAX = 30;

export type AdHocRefusal = 'name_required' | 'name_too_long' | 'member_duplicate' | 'member_not_rostered' | 'too_many_members';

/** The refusals of an ad-hoc entry: a name (1..80), members once each, every member on the org's roster. */
export function adHocEntryRefusal(input: { name: string; memberProfileIds: ReadonlyArray<string> }, rosterIds: ReadonlySet<string>): AdHocRefusal | null {
  const name = input.name.trim();
  if (name.length === 0) return 'name_required';
  if (name.length > AD_HOC_NAME_MAX) return 'name_too_long';
  if (input.memberProfileIds.length > AD_HOC_MEMBERS_MAX) return 'too_many_members';
  if (new Set(input.memberProfileIds).size !== input.memberProfileIds.length) return 'member_duplicate';
  for (const id of input.memberProfileIds) if (!rosterIds.has(id)) return 'member_not_rostered';
  return null;
}

export const AD_HOC_REFUSAL_COPY: Readonly<Record<AdHocRefusal, string>> = {
  name_required: 'Name the side.',
  name_too_long: `Keep the name under ${AD_HOC_NAME_MAX} characters.`,
  member_duplicate: 'A player is listed twice.',
  member_not_rostered: 'Only rostered athletes can play on a side.',
  too_many_members: `At most ${AD_HOC_MEMBERS_MAX} players on a side.`,
};
