// ── Which steps the org wizard shows (Onboarding v2 R2) ─────────────────────
// The Club Model's rule: structure appears only when you need it. A club
// with no divisions and no teams is complete and valid, so the SMALL PATH
// — identity → review (a league adds its sport step) — is the default for
// every org from every entry point. The FULL path (structure, connections)
// is opt-in: the review card's "We run divisions or teams" expander, or a
// club that picks more than one sport (a multi-sport club has divisions by
// definition). Was (phase 7 C2): the two-step path only for a golf club
// that arrived via `?sport=golf` — bare /club/start (the feed card, the
// search footer, /leagues) got the four-step flow with zero sports ticked.
// Pure; node-tested.

export type WizardStep = 'identity' | 'sport' | 'structure' | 'connections' | 'review';

export const STEPS_LEAGUE: readonly WizardStep[] = ['identity', 'sport', 'structure', 'connections', 'review'];
export const STEPS_CLUB: readonly WizardStep[] = ['identity', 'structure', 'connections', 'review'];
export const STEPS_LEAGUE_SMALL: readonly WizardStep[] = ['identity', 'sport', 'review'];
export const STEPS_CLUB_SMALL: readonly WizardStep[] = ['identity', 'review'];

export function isSmallPath(input: { side: 'league' | 'club'; sportsCount: number; expandStructure: boolean }): boolean {
  if (input.expandStructure) return false;
  return input.side === 'league' || input.sportsCount <= 1;
}

export function stepsFor(input: { side: 'league' | 'club'; sportsCount: number; expandStructure: boolean }): readonly WizardStep[] {
  const small = isSmallPath(input);
  if (input.side === 'league') return small ? STEPS_LEAGUE_SMALL : STEPS_LEAGUE;
  return small ? STEPS_CLUB_SMALL : STEPS_CLUB;
}
