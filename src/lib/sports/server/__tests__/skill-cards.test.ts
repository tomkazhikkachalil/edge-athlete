import { describe, it, expect } from 'vitest';
import { assembleSkillCard } from '../index';
import { buildGolfSkillContribution } from '../golf';
import type { HandicapSeriesResult } from '@/lib/golf/handicap';
import type { SportStatsCard } from '../types';

const emptyHandicap = (diffCount: number): HandicapSeriesResult => ({
  diffs: Array.from({ length: diffCount }, (_, i) => 10 + i),
  series: [],
  current: null,
});

const unlockedHandicap: HandicapSeriesResult = {
  diffs: [10.1, 12.4, 9.8, 11.0],
  series: [],
  current: { index: 12.4, roundsCounted: 4, diffsUsed: 1 },
};

const golfStats: SportStatsCard = {
  label: 'Golf Stats',
  tiles: [
    { label: 'Rounds', value: '4' },
    { label: 'Avg Score', value: '88.5' },
    { label: 'Best Score', value: '82' },
  ],
};

describe('buildGolfSkillContribution', () => {
  it('unlocked: tracked headline with formatted index and round count, no progress', () => {
    const c = buildGolfSkillContribution(unlockedHandicap, golfStats);
    expect(c.headline).toEqual({
      value: '12.4',
      label: 'Handicap est.',
      provenance: 'tracked',
      detail: '· 4 rds',
    });
    expect(c.progress).toBeNull();
  });

  it('formats a plus handicap (negative index) with the + convention', () => {
    const c = buildGolfSkillContribution(
      { ...unlockedHandicap, current: { index: -1.5, roundsCounted: 20, diffsUsed: 8 } },
      null
    );
    expect(c.headline?.value).toBe('+1.5');
  });

  it('locked: n-of-3 progress instead of a headline', () => {
    const c = buildGolfSkillContribution(emptyHandicap(1), golfStats);
    expect(c.headline).toBeNull();
    expect(c.progress).toEqual(
      expect.objectContaining({ count: 1, needed: 3, label: 'rated rounds' })
    );
    expect(c.progress?.hint).toContain('course rating');
  });

  it('zero eligible rounds: progress starts at 0, never an error state', () => {
    const c = buildGolfSkillContribution(emptyHandicap(0), null);
    expect(c.progress).toEqual(
      expect.objectContaining({ count: 0, needed: 3, label: 'rated rounds' })
    );
    expect(c.tiles).toEqual([]);
  });

  it('stats tiles ride along marked tracked', () => {
    const c = buildGolfSkillContribution(unlockedHandicap, golfStats);
    expect(c.tiles).toHaveLength(3);
    expect(c.tiles?.every(t => t.provenance === 'tracked')).toBe(true);
    expect(c.tiles?.[0]).toEqual({ label: 'Rounds', value: '4', provenance: 'tracked' });
  });

  it('links to the golf trends page', () => {
    expect(buildGolfSkillContribution(emptyHandicap(0), null).detailHref).toBe('/app/sport/golf/trends');
  });
});

describe('assembleSkillCard', () => {
  const levelItem = { key: 'competitive_level', label: 'Level', value: 'Elite (AAA)' };
  const positionItem = { key: 'position', label: 'Position', value: 'Center' };

  it('promotes the self-reported competitive level to the headline when nothing is tracked', () => {
    const card = assembleSkillCard('ice_hockey', null, [levelItem, positionItem]);
    expect(card?.headline).toEqual({ value: 'Elite (AAA)', label: 'Level', provenance: 'entered' });
    // The promoted item must not also render as a chip.
    expect(card?.entered).toEqual([positionItem]);
  });

  it('a tracked headline wins over the entered level, which stays a chip', () => {
    const tracked = {
      headline: { value: '12.4', label: 'Handicap est.', provenance: 'tracked' as const },
    };
    const card = assembleSkillCard('golf', tracked, [levelItem]);
    expect(card?.headline?.provenance).toBe('tracked');
    expect(card?.entered).toEqual([levelItem]);
  });

  it('returns null when there is nothing at all to show (empty onboarding row)', () => {
    expect(assembleSkillCard('basketball', null, [])).toBeNull();
    expect(assembleSkillCard('basketball', { tiles: [] }, [])).toBeNull();
  });

  it('a progress state alone is enough to render a card', () => {
    const card = assembleSkillCard(
      'golf',
      { progress: { count: 0, needed: 3, label: 'rated rounds' } },
      []
    );
    expect(card).not.toBeNull();
    expect(card?.headline).toBeNull();
    expect(card?.progress?.needed).toBe(3);
  });

  it('an entered level can coexist with a progress state (level headline + progress)', () => {
    const card = assembleSkillCard(
      'golf',
      { progress: { count: 1, needed: 3, label: 'rated rounds' } },
      [levelItem]
    );
    expect(card?.headline?.provenance).toBe('entered');
    expect(card?.progress?.count).toBe(1);
  });

  it('sport label comes from the registry, never hardcoded', () => {
    const card = assembleSkillCard('ice_hockey', null, [levelItem]);
    expect(card?.sportLabel).toBe('Ice Hockey');
  });
});
