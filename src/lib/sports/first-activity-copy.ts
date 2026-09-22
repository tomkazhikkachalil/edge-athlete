import { getStatSchema } from './stat-schemas';

/**
 * The Get Started checklist's first step, in the athlete's sport (Round 4,
 * Sep 2026): a golfer logs a round, a hockey player a game, a runner a race.
 * Pure — the card renders it, the test pins it. Golf (and unknown) keep the original.
 */
export function firstActivityCopy(sport: string | null | undefined): { label: string; hint: string; cta: string } {
  const schema = sport ? getStatSchema(sport) : null;
  if (!schema) {
    return { label: 'Log your first round', hint: 'Pick the course from search and your handicap starts immediately.', cta: 'Log a round →' };
  }
  const noun = schema.activityNoun.toLowerCase();
  const hint = sport === 'track_field'
    ? 'Your times become personal bests, season by season.'
    : `Your ${schema.heroStat.label.toLowerCase()} start adding up, season by season.`;
  return { label: `Log your first ${noun}`, hint, cta: `Log a ${noun} →` };
}
