/**
 * Which sports have a sport profile (docs/specs/sport-profile.md). One rule
 * for the server (the skill card says it, so a page needs no stat sheet to
 * know) and for the Stats tab.
 */
import { getStatSchema } from '@/lib/sports/stat-schemas';
import type { SportKey } from '@/lib/sports/SportRegistry';
import { gameHasSides } from '@/lib/videos/game-rules';

/**
 * Every sport with a stat sheet, except track and field — it keeps its
 * personal-best table and race log on the Stats tab — and golf, which has
 * its own tables.
 */
export function hasSportProfile(sportKey: string): boolean {
  return sportKey !== 'golf' && sportKey !== 'track_field' && !!getStatSchema(sportKey as SportKey);
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
