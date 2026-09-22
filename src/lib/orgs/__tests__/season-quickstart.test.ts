import { describe, expect, it } from 'vitest';
import { seasonCompetitionName } from '../season-quickstart-server';
import { SeasonQuickstartSchema } from '@/lib/competitions/validate';

// Round 4: the team sport's "Start our season". The name and the body's
// shape are pure; the composition is proven by the console spec on staging.

describe('season quickstart', () => {
  it('names the competition after the sport and the season', () => {
    expect(seasonCompetitionName('ice_hockey', '2026–27')).toBe('Ice Hockey 2026–27 league');
    expect(seasonCompetitionName('soccer', '2026')).toBe('Soccer 2026 league');
    expect(seasonCompetitionName('unknown_sport', '2026')).toBe('unknown_sport 2026 league');
  });
  it('the body is one sport key', () => {
    expect(SeasonQuickstartSchema.safeParse({ sport: 'ice_hockey' }).success).toBe(true);
    expect(SeasonQuickstartSchema.safeParse({ sport: 'Ice Hockey' }).success).toBe(false);
    expect(SeasonQuickstartSchema.safeParse({}).success).toBe(false);
  });
});
