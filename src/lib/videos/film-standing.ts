/**
 * What a tagged game is worth as a record (Nov 14 2026 — Tom's rule). Pure,
 * zero imports. "Only league and club tagged data is the only verified data
 * for stats": a game on a CLUB's or LEAGUE's video is verified film; a game
 * tagged on anyone else's video is recreational — it is shown, labelled, and
 * never counted. A verified game counts only when every scoring play is
 * tagged (coverage `full`): a highlights-only video would under-count.
 */
export type FilmStanding = 'verified' | 'verified_highlights' | 'recreational';

export function filmStanding(ownerKind: 'org' | 'profile', coverage: 'highlights' | 'full' | null | undefined): FilmStanding {
  if (ownerKind !== 'org') return 'recreational';
  return coverage === 'full' ? 'verified' : 'verified_highlights';
}

/** Only a fully tagged club or league game can be counted. */
export function filmCountable(standing: FilmStanding | null | undefined): boolean {
  return standing === 'verified';
}

export const FILM_COPY = {
  verifiedHeading: 'Verified — tagged by a club or league',
  recreationalHeading: 'Recreational — not verified',
  recreationalNote: 'Tagged on a video that is not a club\'s or league\'s. Shown here, never counted.',
  highlightsNote: 'Highlights only — not every play is tagged, so this game is not counted.',
  noDateNote: 'No date played on this game yet, so it is not counted.',
  countedNote: 'Counted in the season totals.',
  intro: 'Built from the tags on a full-game video. A club\'s or league\'s fully tagged game is verified and counts in the season totals — once: an official line for the same game takes its place. A game tagged by anyone else is recreational: shown, never counted.',
} as const;
