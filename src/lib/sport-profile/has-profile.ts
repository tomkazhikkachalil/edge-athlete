/**
 * Which sports have a sport profile (docs/specs/sport-profile.md). One rule
 * for the server (the skill card says it, so a page needs no stat sheet to
 * know) and for the Stats tab.
 */
import { getStatSchema } from '@/lib/sports/stat-schemas';
import type { SportKey } from '@/lib/sports/SportRegistry';
import { gameHasSides } from '@/lib/videos/game-rules';
import { sportNoun, type SportNoun } from './view';

/**
 * Every sport with a stat sheet, and golf — which has no stat sheet and its
 * own payload (golf-rules.ts; "one wave" phase 3, Nov 2026). Track and field
 * joined in phase 4: each event's column is a best, so its personal-best
 * table and race log are the profile's own tables.
 */
export function hasSportProfile(sportKey: string): boolean {
  return sportKey === 'golf' || !!getStatSchema(sportKey as SportKey);
}

/**
 * Do this sport's numbers ADD UP? A game with two sides does (goals,
 * points, takedowns). A race does not: its numbers are times and marks —
 * a sum of them means nothing — so its sport profile counts the races and
 * shows the bests, never a total.
 */
export function sportSums(sportKey: string): boolean {
  return gameHasSides(sportKey);
}

/** What one entry of this sport is called on its pages: "game" where there are two sides, else the sheet's noun ("race", "run"). */
export function nounOf(sportKey: string): SportNoun {
  return sportNoun(sportSums(sportKey), getStatSchema(sportKey as SportKey)?.activityNoun);
}
